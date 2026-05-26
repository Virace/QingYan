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
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
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

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

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
			url: "/qingyan/api/admin/comments?siteKey=fangyuan&limit=20&offset=0",
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
			url: "/qingyan/api/admin/comments/c_admin_1",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
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
			url: "/qingyan/api/admin/comments/c_admin_1",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
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

	it("lists and updates spam and trash comments without exposing them publicly", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:moderation-statuses",
			pageTitle: "Moderation Statuses",
			pageUrl: "/posts/moderation-statuses/",
			commentCount: 3,
			rootCommentCount: 3,
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:moderation-statuses"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(comments).values([
			{
				id: "c_admin_spam",
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: null,
				status: "spam",
				authorName: "Spam",
				contentRaw: "spam comment",
				contentHtml: "<p>spam comment</p>",
				replyCount: 0,
				voteUpCount: 0,
				voteDownCount: 0,
				createdAt: "2026-05-26T10:00:00.000Z",
				updatedAt: "2026-05-26T10:00:00.000Z",
			},
			{
				id: "c_admin_trash",
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: null,
				status: "trash",
				authorName: "Trash",
				contentRaw: "trash comment",
				contentHtml: "<p>trash comment</p>",
				replyCount: 0,
				voteUpCount: 0,
				voteDownCount: 0,
				createdAt: "2026-05-26T10:01:00.000Z",
				updatedAt: "2026-05-26T10:01:00.000Z",
			},
			{
				id: "c_admin_public",
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: null,
				status: "approved",
				authorName: "Public",
				contentRaw: "public comment",
				contentHtml: "<p>public comment</p>",
				replyCount: 0,
				voteUpCount: 0,
				voteDownCount: 0,
				createdAt: "2026-05-26T10:02:00.000Z",
				updatedAt: "2026-05-26T10:02:00.000Z",
			},
		]);

		const spamList = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/comments?siteKey=fangyuan&status=spam&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(spamList.statusCode).toBe(200);
		expect(spamList.json()).toMatchObject({
			items: [
				{
					id: "c_admin_spam",
					status: "spam",
				},
			],
			pagination: {
				totalCount: 1,
			},
		});

		const trashList = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/comments?siteKey=fangyuan&status=trash&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(trashList.statusCode).toBe(200);
		expect(trashList.json()).toMatchObject({
			items: [
				{
					id: "c_admin_trash",
					status: "trash",
				},
			],
			pagination: {
				totalCount: 1,
			},
		});

		const hiddenList = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/comments?siteKey=fangyuan&statusGroup=hidden&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(hiddenList.statusCode).toBe(200);
		expect(hiddenList.json()).toMatchObject({
			items: [
				{
					id: "c_admin_trash",
					status: "trash",
				},
				{
					id: "c_admin_spam",
					status: "spam",
				},
			],
			pagination: {
				totalCount: 2,
			},
		});

		const patchToSpam = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/comments/c_admin_public",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				status: "spam",
			},
		});
		expect(patchToSpam.statusCode).toBe(200);
		expect(patchToSpam.json().comment).toMatchObject({
			id: "c_admin_public",
			status: "spam",
		});

		const patchToTrash = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/comments/c_admin_public",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				status: "trash",
			},
		});
		expect(patchToTrash.statusCode).toBe(200);
		expect(patchToTrash.json().comment).toMatchObject({
			id: "c_admin_public",
			status: "trash",
		});

		const publicThread = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/thread?siteKey=fangyuan&pageKey=post:moderation-statuses",
		});
		expect(publicThread.statusCode).toBe(200);
		expect(publicThread.json().comments).toEqual([]);
	});

	it("creates a verified reply from admin comments API", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
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
			url: "/qingyan/api/admin/comments/c_admin_reply_root/reply",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
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

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
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
			url: "/qingyan/api/admin/comments/c_admin_reply_disabled_root/reply",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
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
