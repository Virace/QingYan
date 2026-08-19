import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import {
	adminUsers,
	adminUserSiteAccess,
	commenterNotificationPreferences,
	comments,
	notificationDeliveries,
	pageThreads,
	sitePageRegistry,
	siteSettings,
	sites,
	taskRuns,
} from "../../src/db/schema";
import { AdminSystemSettingsRepository } from "../../src/modules/admin/system-settings-repository";
import { serializeSiteModerationSettings } from "../../src/modules/comments/moderation-types";
import { serializeVerifiedAuthorSettings } from "../../src/modules/comments/verified-author";
import { hashNotificationEmail } from "../../src/modules/notifications/email-address-policy";
import { BackendUserNotificationPlanner } from "../../src/modules/notifications/backend-user-notification-planner";
import { CommenterPreferencesRepository } from "../../src/modules/notifications/commenter-preferences-repository";
import {
	SiteNotificationEventsRepository,
	siteBackendNotificationEventTypes,
} from "../../src/modules/notifications/site-notification-events-repository";
import { UnsubscribeTokenService } from "../../src/modules/notifications/unsubscribe-token-service";
import { NotificationWorker } from "../../src/modules/notifications/notification-worker";
import { NotificationTemplateContextBuilder } from "../../src/modules/notifications/notification-template-context";
import { DatabaseTaskQueue } from "../../src/modules/tasks/database-task-queue";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import { deriveCanonicalPageKeyFromPathname } from "../../src/modules/shared/canonical-page-key";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	vi.restoreAllMocks();
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

async function seedActivePage(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
	pageKey: string,
) {
	const canonicalPageKey = deriveCanonicalPageKeyFromPathname(pageKey);
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
		pageKey: canonicalPageKey,
		pageUrl: canonicalPageKey,
		status: "active",
	});
	return site;
}

async function enableReplyEmailCapability(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
	siteId: number,
) {
	const systemSettings = new AdminSystemSettingsRepository(fixture.app.db);
	await systemSettings.upsert("mail", "enabled", true);
	await systemSettings.upsert("mail", "smtp.host", "smtp.example.test");
	await systemSettings.upsert("mail", "smtp.from", "notify@example.test");
	await fixture.app.db
		.update(siteSettings)
		.set({
			commenterReplyEmailEnabled: true,
		})
		.where(eq(siteSettings.siteId, siteId));
}

async function configureBackendCommentRecipient(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
	siteId: number,
	events: Array<"admin_comment_pending" | "admin_comment_approved">,
) {
	const systemSettings = new AdminSystemSettingsRepository(fixture.app.db);
	await systemSettings.upsert("mail", "enabled", true);
	await systemSettings.upsert("mail", "smtp.host", "smtp.example.test");
	await systemSettings.upsert("mail", "smtp.from", "notify@example.test");
	await fixture.app.db
		.update(siteSettings)
		.set({ backendNotificationsEnabled: true })
		.where(eq(siteSettings.siteId, siteId));
	const [admin] = await fixture.app.db.select().from(adminUsers).limit(1);
	if (!admin) {
		throw new Error("Expected initial admin user");
	}
	await fixture.app.db
		.insert(adminUserSiteAccess)
		.values({
			userId: admin.id,
			siteId,
		})
		.onConflictDoNothing();
	await new SiteNotificationEventsRepository(fixture.app.db).replaceSiteEvents({
		siteId,
		events: siteBackendNotificationEventTypes.map((eventType) => ({
			eventType,
			recipientUserIds: events.includes(eventType) ? [admin.id] : [],
			externalChannelConfigIds: [],
		})),
	});
	return admin;
}

async function postComment(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
	input: {
		pageKey: string;
		parentCommentId: string | null;
		email: string;
		content: string;
		notifyOnReply?: boolean;
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
			...(input.notifyOnReply === undefined
				? {}
				: {
						options: {
							notifyOnReply: input.notifyOnReply,
						},
					}),
		},
	});
}

describe("comment notifications", () => {
	it.each([
		{
			label: "pending",
			manualModeration: true,
			eventFamily: "admin_comment_pending",
		},
		{
			label: "approved",
			manualModeration: false,
			eventFamily: "admin_comment_approved",
		},
	])("plans a backend-user delivery for an ordinary $label public comment", async ({
		label,
		manualModeration,
		eventFamily,
	}) => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const pageKey = `post:backend-${label}`;
		const site = await seedActivePage(fixture, pageKey);
		if (manualModeration) {
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
		}
		const admin = await configureBackendCommentRecipient(fixture, site.id, [
			eventFamily as "admin_comment_pending" | "admin_comment_approved",
		]);

		const response = await postComment(fixture, {
			pageKey,
			parentCommentId: null,
			email: `${label}@example.com`,
			content: `${label} comment for backend recipient`,
			notifyOnReply: false,
		});

		expect(response.statusCode).toBe(200);
		const deliveries = await fixture.app.db
			.select()
			.from(notificationDeliveries);
		expect(deliveries).toEqual([
			expect.objectContaining({
				recipientType: "backend_user",
				recipientUserId: admin.id,
				recipientAddressSnapshot: admin.email,
				channel: "email",
				channelConfigRef: "email:default",
				eventFamily,
			}),
		]);
	});

	it("keeps the public comment successful when backend notification planning fails", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedActivePage(fixture, "post:backend-planner-failure");
		const planner = vi
			.spyOn(BackendUserNotificationPlanner.prototype, "planForCommentEvent")
			.mockRejectedValueOnce(new Error("planner unavailable"));

		const response = await postComment(fixture, {
			pageKey: "post:backend-planner-failure",
			parentCommentId: null,
			email: "planner-failure@example.com",
			content: "comment survives notification planner failure",
			notifyOnReply: false,
		});

		expect(response.statusCode).toBe(200);
		expect(planner).toHaveBeenCalledOnce();
		expect(
			await fixture.app.db
				.select({ id: comments.id, contentRaw: comments.contentRaw })
				.from(comments),
		).toContainEqual({
			id: response.json().comment.id,
			contentRaw: "comment survives notification planner failure",
		});
	});

	it("does not create a backend new-comment delivery for a staff reply", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const site = await seedActivePage(fixture, "post:staff-backend-skip");
		await configureBackendCommentRecipient(fixture, site.id, [
			"admin_comment_approved",
		]);
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
		const parent = await postComment(fixture, {
			pageKey: "post:staff-backend-skip",
			parentCommentId: null,
			email: "parent-staff-skip@example.com",
			content: "ordinary parent comment",
			notifyOnReply: false,
		});
		expect(parent.statusCode).toBe(200);
		const initialBackendDeliveries = (
			await fixture.app.db.select().from(notificationDeliveries)
		).filter((delivery) => delivery.recipientType === "backend_user");
		expect(initialBackendDeliveries).toHaveLength(1);

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const reply = await postComment(fixture, {
			pageKey: "post:staff-backend-skip",
			parentCommentId: parent.json().comment.id,
			email: "owner@example.com",
			content: "staff reply should not notify staff again",
			notifyOnReply: false,
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(reply.statusCode).toBe(200);
		const backendDeliveries = (
			await fixture.app.db.select().from(notificationDeliveries)
		).filter((delivery) => delivery.recipientType === "backend_user");
		expect(backendDeliveries).toHaveLength(1);
	});

	it("persists notifyOnReply preference for ordinary commenter writes", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const site = await seedActivePage(fixture, "post:preference");
		await enableReplyEmailCapability(fixture, site.id);

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

	it("does not enable commenter preference when reply email notification is unavailable", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedActivePage(fixture, "post:preference-unavailable");

		const response = await postComment(fixture, {
			pageKey: "post:preference-unavailable",
			parentCommentId: null,
			email: "unavailable@example.com",
			content: "old client still submits notifyOnReply",
			notifyOnReply: true,
		});

		expect(response.statusCode).toBe(200);
		const [preference] = await fixture.app.db
			.select()
			.from(commenterNotificationPreferences);
		expect(preference).toMatchObject({
			email: "unavailable@example.com",
			notifyOnReply: false,
			unsubscribedAt: null,
		});
	});

	it("does not infer commenter consent when notifyOnReply is omitted", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const site = await seedActivePage(fixture, "post:preference-omitted");
		await enableReplyEmailCapability(fixture, site.id);
		await fixture.app.db
			.update(siteSettings)
			.set({ commenterReplyEmailDefaultChecked: true })
			.where(eq(siteSettings.siteId, site.id));

		const response = await postComment(fixture, {
			pageKey: "post:preference-omitted",
			parentCommentId: null,
			email: "omitted@example.com",
			content: "client omitted notifyOnReply",
		});

		expect(response.statusCode).toBe(200);
		const [preference] = await fixture.app.db
			.select()
			.from(commenterNotificationPreferences);
		expect(preference).toMatchObject({
			email: "omitted@example.com",
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
		await enableReplyEmailCapability(fixture, site.id);

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
		expect(
			(await fixture.app.db.select().from(taskRuns)).filter(
				(task) => task.type === "reply_approved",
			),
		).toEqual([]);

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
		expect(tasks.filter((task) => task.type === "reply_approved")).toHaveLength(
			1,
		);
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
		await enableReplyEmailCapability(fixture, site.id);
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
		const browserIssued = await tokens.issue({
			siteId: site.id,
			email: "subscriber@example.com",
			purpose: "commenter_reply",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/notifications/unsubscribe?token=${encodeURIComponent(
				issued.token,
			)}`,
			headers: {
				accept: "application/json",
			},
		});
		const replay = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/notifications/unsubscribe?token=${encodeURIComponent(
				issued.token,
			)}`,
			headers: {
				accept: "application/json",
			},
		});
		const browserResponse = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/notifications/unsubscribe?token=${encodeURIComponent(
				browserIssued.token,
			)}`,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			status: "unsubscribed",
		});
		expect(replay.statusCode).toBe(404);
		expect(browserResponse.statusCode).toBe(200);
		expect(browserResponse.headers["content-type"]).toContain("text/html");
		expect(browserResponse.body).toContain("已退订评论回复提醒");
		expect(browserResponse.body).not.toContain('{"status":"unsubscribed"}');
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

	it("sends one commenter reply email with unsubscribe link and suppresses later replies after unsubscribe", async () => {
		const sentMessages: Array<{ to: string; body: string }> = [];
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const site = await seedActivePage(fixture, "post:worker-unsubscribe");
		await enableReplyEmailCapability(fixture, site.id);

		const parent = await postComment(fixture, {
			pageKey: "post:worker-unsubscribe",
			parentCommentId: null,
			email: "parent-worker@example.com",
			content: "parent wants a real unsubscribe link",
			notifyOnReply: true,
		});
		expect(parent.statusCode).toBe(200);
		const parentId = parent.json().comment.id as string;
		const reply = await postComment(fixture, {
			pageKey: "post:worker-unsubscribe",
			parentCommentId: parentId,
			email: "reply-worker@example.com",
			content: "first reply",
			notifyOnReply: false,
		});
		expect(reply.statusCode).toBe(200);

		const repository = new TaskRunRepository(fixture.app.db);
		const worker = new NotificationWorker({
			queue: new DatabaseTaskQueue(fixture.app.db),
			repository,
			adapters: {
				email: {
					async send(input) {
						sentMessages.push({ to: input.to, body: input.body });
						return { providerMessageId: `test-${sentMessages.length}` };
					},
				},
			},
			templateContextBuilder: new NotificationTemplateContextBuilder(
				fixture.app.db,
				{
					publicBaseUrl: "http://localhost:4401",
					publicPath: "/qingyan",
				},
			),
		});

		expect(await worker.runNextNotificationTask({ limit: 1 })).toBe(1);
		expect(sentMessages).toEqual([
			expect.objectContaining({
				to: "parent-worker@example.com",
				body: expect.stringContaining("Visitor 在 Notifications 回复了你"),
			}),
		]);
		expect(sentMessages[0]?.body).toContain("first reply");
		expect(sentMessages[0]?.body).toContain(
			"查看页面：http://localhost:4321/post:worker-unsubscribe",
		);
		expect(sentMessages[0]?.body).toContain("如需退订可点击：");
		expect(sentMessages[0]?.body).toContain(
			"/qingyan/notifications/unsubscribe?token=",
		);
		const token = sentMessages[0]?.body.match(
			/\/qingyan\/notifications\/unsubscribe\?token=([^\s"'<>]+)/u,
		)?.[1];
		expect(token).toEqual(expect.any(String));
		const [firstDelivery] = await fixture.app.db
			.select()
			.from(notificationDeliveries);
		expect(firstDelivery).toMatchObject({
			recipientType: "commenter",
			recipientAddressSnapshot: "parent-worker@example.com",
			status: "sent",
			providerMessageId: "test-1",
		});

		const unsubscribe = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/notifications/unsubscribe?token=${token}`,
			headers: {
				accept: "application/json",
			},
		});
		expect(unsubscribe.statusCode).toBe(200);

		const secondReply = await postComment(fixture, {
			pageKey: "post:worker-unsubscribe",
			parentCommentId: parentId,
			email: "another-reply-worker@example.com",
			content: "second reply after unsubscribe",
			notifyOnReply: false,
		});
		expect(secondReply.statusCode).toBe(200);

		expect(await worker.runNextNotificationTask({ limit: 1 })).toBe(0);
		expect(sentMessages).toHaveLength(1);
		const deliveries = await fixture.app.db
			.select()
			.from(notificationDeliveries);
		expect(deliveries).toHaveLength(1);
		const [preference] = await fixture.app.db
			.select()
			.from(commenterNotificationPreferences)
			.where(
				eq(commenterNotificationPreferences.email, "parent-worker@example.com"),
			);
		expect(preference).toMatchObject({
			notifyOnReply: false,
			source: "unsubscribe_link",
		});
		expect(preference?.unsubscribedAt).toEqual(expect.any(String));
		const threadReplies = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.parentId, parentId));
		expect(threadReplies).toHaveLength(2);
	});
});
