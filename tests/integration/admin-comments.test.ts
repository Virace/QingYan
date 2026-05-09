import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	blacklistRules,
	comments,
	pageThreads,
	siteSettings,
	sites,
} from "../../src/db/schema";
import { serializeVerifiedAuthorSettings } from "../../src/modules/comments/verified-author";
import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin comments", () => {
	it("lists, updates and soft deletes comments", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);

		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:admin-comments",
			pageTitle: "Admin Comments",
			pageUrl: "/posts/admin-comments/",
			commentCount: 1,
			rootCommentCount: 1,
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:admin-comments"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(comments).values({
			id: "c_admin_1",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: null,
			status: "pending",
			authorName: "Admin Test",
			authorEmail: "admin@example.com",
			authorIp: "203.0.113.10",
			authorUserAgent: "QingYan Test Browser",
			contentRaw: "pending comment",
			contentHtml: "<p>pending comment</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-04-17T10:00:00.000Z",
			updatedAt: "2026-04-17T10:00:00.000Z",
		});
		await fixture.app.db.insert(blacklistRules).values([
			{
				siteId: site.id,
				scope: "post",
				targetType: "email",
				targetValue: "admin@example.com",
				matchMode: "exact",
				source: "manual",
			},
			{
				siteId: site.id,
				scope: "post",
				targetType: "ip",
				targetValue: "203.0.113.10",
				matchMode: "exact",
				source: "manual",
			},
		]);

		const listResponse = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/comments?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.json()).toMatchObject({
			items: [
				{
					id: "c_admin_1",
					status: "pending",
					authorEmail: "admin@example.com",
					authorIp: "203.0.113.10",
					authorUserAgent: "QingYan Test Browser",
					blacklist: {
						email: true,
						ip: true,
					},
					pageUrl: "http://localhost:4321/posts/admin-comments/",
				},
			],
			pagination: {
				totalCount: 1,
			},
		});

		const patchResponse = await fixture.app.inject({
			method: "PATCH",
			url: "/api/admin/comments/c_admin_1",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
			payload: {
				status: "approved",
				isPinned: true,
			},
		});
		expect(patchResponse.statusCode).toBe(200);
		expect(patchResponse.json()).toMatchObject({
			comment: {
				id: "c_admin_1",
				status: "approved",
				isPinned: true,
			},
		});

		const deleteResponse = await fixture.app.inject({
			method: "DELETE",
			url: "/api/admin/comments/c_admin_1",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(deleteResponse.statusCode).toBe(200);
		expect(deleteResponse.json()).toMatchObject({
			comment: {
				id: "c_admin_1",
			},
		});

		const [deletedComment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.id, "c_admin_1"));
		expect(deletedComment?.deletedAt).not.toBeNull();
	});

	it("creates a verified reply from admin comments API", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);
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
				verifiedAuthorJson: serializeVerifiedAuthorSettings({
					enabled: true,
					displayName: "Virace",
					email: "owner@example.com",
					website: "https://fangyuan.example.com/about",
					badgeLabel: "楼主",
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:admin-reply",
			pageTitle: "Admin Reply",
			pageUrl: "/posts/admin-reply/",
			commentCount: 1,
			rootCommentCount: 1,
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:admin-reply"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(comments).values({
			id: "c_admin_reply_root",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: null,
			status: "approved",
			authorName: "Visitor",
			authorEmail: "visitor@example.com",
			contentRaw: "root comment",
			contentHtml: "<p>root comment</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-05-09T10:00:00.000Z",
			updatedAt: "2026-05-09T10:00:00.000Z",
		});

		const reply = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/comments/c_admin_reply_root/reply",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				content: {
					raw: "管理员回复",
				},
			},
		});

		expect(reply.statusCode).toBe(200);
		expect(reply.json().comment.author).toMatchObject({
			name: "Virace",
			badge: { label: "楼主" },
		});

		const [created] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.contentRaw, "管理员回复"));
		expect(created).toMatchObject({
			parentId: "c_admin_reply_root",
			authorIdentity: "verified",
			authorEmail: "owner@example.com",
			status: "approved",
		});

		const [updatedRoot] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.id, "c_admin_reply_root"));
		expect(updatedRoot?.replyCount).toBe(1);
	});

	it("rejects admin replies when verified author is disabled", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);
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
				verifiedAuthorJson: serializeVerifiedAuthorSettings({
					enabled: false,
					displayName: "Virace",
					email: "owner@example.com",
					website: "https://fangyuan.example.com/about",
					badgeLabel: "楼主",
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:admin-reply-disabled",
			pageTitle: "Admin Reply Disabled",
			pageUrl: "/posts/admin-reply-disabled/",
			commentCount: 1,
			rootCommentCount: 1,
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:admin-reply-disabled"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(comments).values({
			id: "c_admin_reply_disabled_root",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: null,
			status: "approved",
			authorName: "Visitor",
			contentRaw: "root comment",
			contentHtml: "<p>root comment</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-05-09T10:00:00.000Z",
			updatedAt: "2026-05-09T10:00:00.000Z",
		});

		const reply = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/comments/c_admin_reply_disabled_root/reply",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				content: {
					raw: "管理员回复",
				},
			},
		});

		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toMatchObject({
			error: {
				code: "VERIFIED_AUTHOR_DISABLED",
			},
		});
	});
});
