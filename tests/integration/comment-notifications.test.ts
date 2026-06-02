import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	adminUsers,
	commenterNotificationPreferences,
	comments,
	notificationDeliveries,
	pageThreads,
	sitePageRegistry,
	siteSettings,
	sites,
	taskRuns,
} from "../../src/db/schema";
import { serializeSiteModerationSettings } from "../../src/modules/comments/moderation-types";
import { serializeVerifiedAuthorSettings } from "../../src/modules/comments/verified-author";
import { hashNotificationEmail } from "../../src/modules/notifications/email-address-policy";
import { CommenterPreferencesRepository } from "../../src/modules/notifications/commenter-preferences-repository";
import { UnsubscribeTokenService } from "../../src/modules/notifications/unsubscribe-token-service";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

async function seedActivePage(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
	pageKey: string,
) {
	const [site] = await fixture.app.db
		.select()
		.from(sites)
		.where(eq(sites.siteKey, "fangyuan"));
	if (!site) {
		throw new Error("Expected site to exist");
	}
	await fixture.app.db
		.update(siteSettings)
		.set({
			commentRequireJson: JSON.stringify(["nickname", "email"]),
			moderationJson: serializeSiteModerationSettings({
				mode: "none",
				provider: "none",
				akismet: {
					failPolicy: "pending",
					discardBlatantSpam: false,
				},
			}),
		})
		.where(eq(siteSettings.siteId, site.id));
	await fixture.app.db.insert(sitePageRegistry).values({
		siteId: site.id,
		pageKey,
		pageUrl: `/${pageKey}`,
		status: "active",
	});
	return site;
}

async function postComment(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
	input: {
		pageKey: string;
		parentCommentId: string | null;
		email: string;
		content: string;
		notifyOnReply: boolean;
		cookies?: Record<string, string>;
	},
) {
	return fixture.app.inject({
		method: "POST",
		url: "/qingyan/api/comments",
		headers: {
			referer: `http://localhost:4321/${input.pageKey}`,
		},
		cookies: input.cookies,
		payload: {
			siteKey: "fangyuan",
			pageKey: input.pageKey,
			pageTitle: "Notifications",
			parentCommentId: input.parentCommentId,
			author: {
				name: "Visitor",
				email: input.email,
			},
			content: {
				raw: input.content,
			},
			options: {
				notifyOnReply: input.notifyOnReply,
			},
		},
	});
}

describe("comment notifications", () => {
	it("persists notifyOnReply preference for ordinary commenter writes", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedActivePage(fixture, "post:preference");

		const enabled = await postComment(fixture, {
			pageKey: "post:preference",
			parentCommentId: null,
			email: "  Alice@Example.COM ",
			content: "enable replies",
			notifyOnReply: true,
		});
		expect(enabled.statusCode).toBe(200);

		const [preference] = await fixture.app.db
			.select()
			.from(commenterNotificationPreferences);
		expect(preference).toMatchObject({
			email: "alice@example.com",
			emailHash: hashNotificationEmail("alice@example.com"),
			notifyOnReply: true,
			unsubscribedAt: null,
			source: "comment_form",
		});

		const disabled = await postComment(fixture, {
			pageKey: "post:preference",
			parentCommentId: null,
			email: "alice@example.com",
			content: "disable replies",
			notifyOnReply: false,
		});
		expect(disabled.statusCode).toBe(200);

		const rows = await fixture.app.db
			.select()
			.from(commenterNotificationPreferences);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			notifyOnReply: false,
			unsubscribedAt: null,
		});
	});

	it("creates comments but no preference for invalid emails and staff writes", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const site = await seedActivePage(fixture, "post:invalid-and-staff");

		const invalid = await postComment(fixture, {
			pageKey: "post:invalid-and-staff",
			parentCommentId: null,
			email: "root@root.root",
			content: "invalid preference email",
			notifyOnReply: true,
		});
		expect(invalid.statusCode).toBe(200);
		expect(
			await fixture.app.db.select().from(commenterNotificationPreferences),
		).toEqual([]);

		await fixture.app.db
			.update(siteSettings)
			.set({
				verifiedAuthorJson: serializeVerifiedAuthorSettings({
					enabled: true,
					displayName: "Virace",
					email: "owner@example.com",
					website: "https://fangyuan.example.com/about",
					badgeLabel: "楼主",
				}),
			})
			.where(eq(siteSettings.siteId, site.id));
		const { adminCookie } = await loginAsAdmin(fixture.app);
		const staff = await postComment(fixture, {
			pageKey: "post:invalid-and-staff",
			parentCommentId: null,
			email: "admin@example.com",
			content: "staff comment",
			notifyOnReply: true,
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(staff.statusCode).toBe(200);
		expect(
			await fixture.app.db.select().from(commenterNotificationPreferences),
		).toEqual([]);
	});

	it("plans commenter email notification only after a pending reply is approved", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const site = await seedActivePage(fixture, "post:approve-reply");

		const parent = await postComment(fixture, {
			pageKey: "post:approve-reply",
			parentCommentId: null,
			email: "parent@example.com",
			content: "parent wants replies",
			notifyOnReply: true,
		});
		expect(parent.statusCode).toBe(200);
		const parentId = parent.json().comment.id as string;
		await fixture.app.db
			.update(siteSettings)
			.set({
				moderationJson: serializeSiteModerationSettings({
					mode: "manual",
					provider: "none",
					akismet: {
						failPolicy: "pending",
						discardBlatantSpam: false,
					},
				}),
			})
			.where(eq(siteSettings.siteId, site.id));
		const reply = await postComment(fixture, {
			pageKey: "post:approve-reply",
			parentCommentId: parentId,
			email: "reply@example.com",
			content: "pending reply",
			notifyOnReply: false,
		});
		expect(reply.statusCode).toBe(200);
		const replyId = reply.json().comment.id as string;
		expect(await fixture.app.db.select().from(taskRuns)).toEqual([]);

		const admin = await loginAsAdmin(fixture.app);
		const approve = await fixture.app.inject({
			method: "PATCH",
			url: `/qingyan/api/admin/comments/${replyId}`,
			...withAdminWriteAuth(admin),
			payload: {
				status: "approved",
			},
		});
		expect(approve.statusCode).toBe(200);
		const approveAgain = await fixture.app.inject({
			method: "PATCH",
			url: `/qingyan/api/admin/comments/${replyId}`,
			...withAdminWriteAuth(admin),
			payload: {
				status: "approved",
			},
		});
		expect(approveAgain.statusCode).toBe(200);

		const tasks = await fixture.app.db.select().from(taskRuns);
		const deliveries = await fixture.app.db
			.select()
			.from(notificationDeliveries);
		expect(tasks).toHaveLength(1);
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0]).toMatchObject({
			recipientType: "commenter",
			recipientAddressSnapshot: "parent@example.com",
			channel: "email",
			templateKey: "commenter.reply_approved",
		});
	});

	it("plans commenter email notification for direct approved admin replies", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const site = await seedActivePage(fixture, "post:admin-reply-notify");
		await fixture.app.db
			.update(siteSettings)
			.set({
				verifiedAuthorJson: serializeVerifiedAuthorSettings({
					enabled: true,
					displayName: "Virace",
					email: "owner@example.com",
					website: "https://fangyuan.example.com/about",
					badgeLabel: "楼主",
				}),
			})
			.where(eq(siteSettings.siteId, site.id));
		const [thread] = await fixture.app.db
			.insert(pageThreads)
			.values({
				siteId: site.id,
				pageKey: "post:admin-reply-notify",
				pageTitle: "Admin Reply Notify",
				pageUrl: "/post:admin-reply-notify",
				commentCount: 1,
				rootCommentCount: 1,
			})
			.returning();
		await fixture.app.db.insert(comments).values({
			id: "c_admin_reply_notify_parent",
			siteId: site.id,
			pageThreadId: thread.id,
			status: "approved",
			authorName: "Parent",
			authorEmail: "parent@example.com",
			contentRaw: "parent",
			contentHtml: "<p>parent</p>",
		});
		await new CommenterPreferencesRepository(
			fixture.app.db,
		).upsertFromCommentForm({
			siteId: site.id,
			email: "parent@example.com",
			notifyOnReply: true,
		});

		const admin = await loginAsAdmin(fixture.app);
		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/comments/c_admin_reply_notify_parent/reply",
			...withAdminWriteAuth(admin),
			payload: {
				content: {
					raw: "admin reply",
				},
			},
		});

		expect(response.statusCode).toBe(200);
		expect(await fixture.app.db.select().from(taskRuns)).toHaveLength(1);
		expect(await fixture.app.db.select().from(notificationDeliveries)).toEqual([
			expect.objectContaining({
				recipientType: "commenter",
				recipientAddressSnapshot: "parent@example.com",
			}),
		]);
	});

	it("unsubscribes commenter preference through the public token route", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const site = await seedActivePage(fixture, "post:unsubscribe");
		const preferences = new CommenterPreferencesRepository(fixture.app.db);
		const tokens = new UnsubscribeTokenService(fixture.app.db, preferences);
		await preferences.upsertFromCommentForm({
			siteId: site.id,
			email: "subscriber@example.com",
			notifyOnReply: true,
		});
		const issued = await tokens.issue({
			siteId: site.id,
			email: "subscriber@example.com",
			purpose: "commenter_reply",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/notifications/unsubscribe?token=${encodeURIComponent(
				issued.token,
			)}`,
		});
		const replay = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/notifications/unsubscribe?token=${encodeURIComponent(
				issued.token,
			)}`,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			status: "unsubscribed",
		});
		expect(replay.statusCode).toBe(404);
		const [preference] = await fixture.app.db
			.select()
			.from(commenterNotificationPreferences);
		expect(preference).toMatchObject({
			notifyOnReply: false,
			source: "unsubscribe_link",
		});
		expect(preference?.unsubscribedAt).toEqual(expect.any(String));

		const [adminUser] = await fixture.app.db.select().from(adminUsers).limit(1);
		expect(adminUser).toBeTruthy();
	});
});
