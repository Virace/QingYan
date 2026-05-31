import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import {
	blacklistRules,
	commentRequestMetadata,
	comments,
	pageThreads,
	siteSettings,
	sites,
} from "../../src/db/schema";
import { serializeVerifiedAuthorSettings } from "../../src/modules/comments/verified-author";
import { AdminSystemSettingsRepository } from "../../src/modules/admin/system-settings-repository";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin comments", () => {
	it("defaults admin comments to active statuses and keeps spam and trash in explicit views", async () => {
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
			pageKey: "post:admin-comment-views",
			pageTitle: "Admin Comment Views",
			pageUrl: "/posts/admin-comment-views/",
			commentCount: 4,
			rootCommentCount: 4,
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:admin-comment-views"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(comments).values([
			{
				id: "c_admin_view_pending",
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: null,
				status: "pending",
				authorName: "Pending",
				contentRaw: "pending",
				contentHtml: "<p>pending</p>",
				createdAt: "2026-05-28T10:00:00.000Z",
				updatedAt: "2026-05-28T10:00:00.000Z",
			},
			{
				id: "c_admin_view_approved",
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: null,
				status: "approved",
				authorName: "Approved",
				contentRaw: "approved",
				contentHtml: "<p>approved</p>",
				createdAt: "2026-05-28T10:01:00.000Z",
				updatedAt: "2026-05-28T10:01:00.000Z",
			},
			{
				id: "c_admin_view_spam",
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: null,
				status: "spam",
				authorName: "Spam",
				contentRaw: "spam",
				contentHtml: "<p>spam</p>",
				createdAt: "2026-05-28T10:02:00.000Z",
				updatedAt: "2026-05-28T10:02:00.000Z",
			},
			{
				id: "c_admin_view_trash",
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: null,
				status: "trash",
				authorName: "Trash",
				contentRaw: "trash",
				contentHtml: "<p>trash</p>",
				createdAt: "2026-05-28T10:03:00.000Z",
				updatedAt: "2026-05-28T10:03:00.000Z",
			},
		]);

		const cookies = {
			qingyan_admin: adminCookie?.value ?? "",
		};
		const defaultList = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/comments?siteKey=fangyuan&limit=20&offset=0",
			cookies,
		});
		expect(defaultList.statusCode).toBe(200);
		expect(
			defaultList.json().items.map((comment: { id: string }) => comment.id),
		).toEqual(["c_admin_view_approved", "c_admin_view_pending"]);
		expect(defaultList.json().pagination.totalCount).toBe(2);

		const spamList = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/comments?siteKey=fangyuan&status=spam&limit=20&offset=0",
			cookies,
		});
		expect(spamList.statusCode).toBe(200);
		expect(
			spamList.json().items.map((comment: { id: string }) => comment.id),
		).toEqual(["c_admin_view_spam"]);
		expect(spamList.json().pagination.totalCount).toBe(1);

		const trashList = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/comments?siteKey=fangyuan&status=trash&limit=20&offset=0",
			cookies,
		});
		expect(trashList.statusCode).toBe(200);
		expect(
			trashList.json().items.map((comment: { id: string }) => comment.id),
		).toEqual(["c_admin_view_trash"]);
		expect(trashList.json().pagination.totalCount).toBe(1);
	});

	it("returns admin comment avatar urls when external avatars are enabled", async () => {
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

		const systemSettings = new AdminSystemSettingsRepository(fixture.app.db);
		await systemSettings.upsert("avatar", "external.enabled", true);
		await systemSettings.upsert(
			"avatar",
			"external.baseUrl",
			"https://cravatar.cn/avatar",
		);
		await systemSettings.upsert("avatar", "external.hashAlgorithm", "md5");
		await systemSettings.upsert(
			"avatar",
			"external.query",
			"s=160&d=identicon",
		);

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:admin-avatar",
			pageTitle: "Admin Avatar",
			pageUrl: "/posts/admin-avatar/",
			commentCount: 1,
			rootCommentCount: 1,
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:admin-avatar"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		const aliceMd5 = createHash("md5")
			.update("alice@example.com")
			.digest("hex");
		await fixture.app.db.insert(comments).values({
			id: "c_admin_avatar",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: null,
			status: "approved",
			authorName: "Alice",
			authorEmail: "alice@example.com",
			contentRaw: "avatar",
			contentHtml: "<p>avatar</p>",
			createdAt: "2026-05-28T10:00:00.000Z",
			updatedAt: "2026-05-28T10:00:00.000Z",
		});

		const enabledList = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/comments?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(enabledList.statusCode).toBe(200);
		expect(enabledList.json().items[0]).toMatchObject({
			id: "c_admin_avatar",
			authorAvatarUrl: `https://cravatar.cn/avatar/${aliceMd5}?s=160&d=identicon`,
		});
		expect(enabledList.json().items[0].authorGravatarUrl).toBeUndefined();

		await systemSettings.upsert("avatar", "external.enabled", false);
		const disabledList = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/comments?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(disabledList.statusCode).toBe(200);
		expect(disabledList.json().items[0]).toMatchObject({
			id: "c_admin_avatar",
			authorAvatarUrl: null,
		});
	});

	it("lists, updates, moves comments to trash and permanently deletes only trashed comments", async () => {
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
			contentRaw: "pending comment",
			contentHtml: "<p>pending comment</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-04-17T10:00:00.000Z",
			updatedAt: "2026-04-17T10:00:00.000Z",
		});
		await fixture.app.db.insert(commentRequestMetadata).values({
			commentId: "c_admin_1",
			authorIp: "203.0.113.10",
			authorUserAgent: "QingYan Test Browser",
			ipCountry: "中国",
			ipRegion: "广东",
			ipCity: "深圳",
			ipIsp: "电信",
			ipLocationSource: "ip2region",
			deviceBrowser: "chrome",
			deviceBrowserVersion: "120.0.0.0",
			deviceOs: "windows",
			deviceOsVersion: "10",
			deviceType: "desktop",
			deviceIcon: "chrome",
			deviceSource: "ua-parser-js",
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
					requestMeta: {
						ip: {
							raw: "203.0.113.10",
							location: {
								label: "中国 / 广东 / 深圳",
								country: "中国",
								region: "广东",
								city: "深圳",
								isp: "电信",
								source: "ip2region",
							},
						},
						userAgent: {
							raw: "QingYan Test Browser",
							device: {
								label: "chrome 120 / windows 10 / desktop",
								browser: "chrome",
								browserVersion: "120.0.0.0",
								os: "windows",
								osVersion: "10",
								type: "desktop",
								icon: "chrome",
								source: "ua-parser-js",
							},
						},
					},
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

		const deleteBeforeTrashResponse = await fixture.app.inject({
			method: "DELETE",
			url: "/qingyan/api/admin/comments/c_admin_1",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
		});
		expect(deleteBeforeTrashResponse.statusCode).toBe(400);
		expect(deleteBeforeTrashResponse.json()).toMatchObject({
			error: {
				code: "COMMENT_NOT_IN_TRASH",
			},
		});

		const moveToTrashResponse = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/comments/c_admin_1",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				status: "trash",
			},
		});
		expect(moveToTrashResponse.statusCode).toBe(200);
		expect(moveToTrashResponse.json()).toMatchObject({
			comment: {
				id: "c_admin_1",
				status: "trash",
			},
		});

		const [trashedComment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.id, "c_admin_1"));
		expect(trashedComment?.status).toBe("trash");
		expect(trashedComment?.deletedAt).toBeNull();

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
					id: "c_admin_1",
					status: "trash",
				},
			],
			pagination: {
				totalCount: 1,
			},
		});

		const permanentDeleteResponse = await fixture.app.inject({
			method: "DELETE",
			url: "/qingyan/api/admin/comments/c_admin_1",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
		});
		expect(permanentDeleteResponse.statusCode).toBe(200);
		expect(permanentDeleteResponse.json()).toMatchObject({
			comment: {
				id: "c_admin_1",
				status: "trash",
			},
		});

		const [deletedComment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.id, "c_admin_1"));
		expect(deletedComment?.status).toBe("trash");
		expect(deletedComment?.deletedAt).not.toBeNull();
	});

	it("refreshes one comment ip location metadata from raw stored ip", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const systemSettings = new AdminSystemSettingsRepository(fixture.app.db);
		await systemSettings.upsert(
			"ipRegion",
			"ipv4.dbPath",
			"./data/missing-ip2region-v4.xdb",
		);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:metadata-refresh",
			pageTitle: "Metadata Refresh",
			pageUrl: "/posts/metadata-refresh/",
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:metadata-refresh"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}
		await fixture.app.db.insert(comments).values({
			id: "c_refresh_location",
			siteId: site.id,
			pageThreadId: thread.id,
			status: "approved",
			authorName: "Refresh",
			contentRaw: "refresh location",
			contentHtml: "<p>refresh location</p>",
		});
		await fixture.app.db.insert(commentRequestMetadata).values({
			commentId: "c_refresh_location",
			authorIp: "203.0.113.44",
			ipLocationError: "old_error",
		});

		const refreshResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/comments/c_refresh_location/metadata/refresh",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
		});

		expect(refreshResponse.statusCode).toBe(200);
		expect(refreshResponse.json()).toMatchObject({
			metadata: {
				commentId: "c_refresh_location",
				authorIp: "203.0.113.44",
				ipLocationError: "xdb_not_found",
			},
		});
		const [metadata] = await fixture.app.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, "c_refresh_location"));
		expect(metadata).toMatchObject({
			authorIp: "203.0.113.44",
			ipLocationError: "xdb_not_found",
		});

		const listResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/comments?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.json().items[0]).toMatchObject({
			id: "c_refresh_location",
			authorIpLocation: {
				error: "xdb_not_found",
			},
		});
	});

	it("bulk updates comment status and flags", async () => {
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
			pageKey: "post:bulk-update",
			pageTitle: "Bulk Update",
			pageUrl: "/posts/bulk-update/",
			commentCount: 2,
			rootCommentCount: 2,
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:bulk-update"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}
		await fixture.app.db.insert(comments).values([
			{
				id: "c_bulk_update_1",
				siteId: site.id,
				pageThreadId: thread.id,
				status: "pending",
				authorName: "Bulk Update 1",
				contentRaw: "bulk update 1",
				contentHtml: "<p>bulk update 1</p>",
			},
			{
				id: "c_bulk_update_2",
				siteId: site.id,
				pageThreadId: thread.id,
				status: "pending",
				authorName: "Bulk Update 2",
				contentRaw: "bulk update 2",
				contentHtml: "<p>bulk update 2</p>",
			},
		]);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/comments/bulk-update",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				commentIds: ["c_bulk_update_1", "c_bulk_update_2"],
				patch: {
					status: "approved",
					isFolded: true,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			updatedCount: 2,
			comments: [
				{
					id: "c_bulk_update_1",
					status: "approved",
					isFolded: true,
				},
				{
					id: "c_bulk_update_2",
					status: "approved",
					isFolded: true,
				},
			],
		});
	});

	it("rejects bulk comment updates without csrf and over 100 ids", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const missingCsrf = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/comments/bulk-update",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
			payload: {
				commentIds: ["c_missing_csrf"],
				patch: {
					status: "approved",
				},
			},
		});
		expect(missingCsrf.statusCode).toBe(403);

		const tooManyIds = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/comments/bulk-update",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				commentIds: Array.from({ length: 101 }, (_, index) => `c_${index}`),
				patch: {
					status: "approved",
				},
			},
		});
		expect(tooManyIds.statusCode).toBe(400);
	});

	it("bulk refreshes selected comment ip metadata", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const systemSettings = new AdminSystemSettingsRepository(fixture.app.db);
		await systemSettings.upsert(
			"ipRegion",
			"ipv4.dbPath",
			"./data/missing-ip2region-v4.xdb",
		);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:bulk-metadata-refresh",
			pageTitle: "Bulk Metadata Refresh",
			pageUrl: "/posts/bulk-metadata-refresh/",
			commentCount: 2,
			rootCommentCount: 2,
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:bulk-metadata-refresh"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}
		await fixture.app.db.insert(comments).values([
			{
				id: "c_bulk_refresh_1",
				siteId: site.id,
				pageThreadId: thread.id,
				status: "approved",
				authorName: "Bulk Refresh 1",
				contentRaw: "bulk refresh 1",
				contentHtml: "<p>bulk refresh 1</p>",
			},
			{
				id: "c_bulk_refresh_2",
				siteId: site.id,
				pageThreadId: thread.id,
				status: "approved",
				authorName: "Bulk Refresh 2",
				contentRaw: "bulk refresh 2",
				contentHtml: "<p>bulk refresh 2</p>",
			},
		]);
		await fixture.app.db.insert(commentRequestMetadata).values([
			{
				commentId: "c_bulk_refresh_1",
				authorIp: "203.0.113.21",
				ipLocationError: "old_error",
			},
			{
				commentId: "c_bulk_refresh_2",
				authorIp: "203.0.113.22",
				ipLocationError: "old_error",
			},
		]);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/comments/metadata/refresh",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				commentIds: ["c_bulk_refresh_1", "c_bulk_refresh_2"],
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			refreshedCount: 2,
			failedCount: 0,
			items: [
				expect.objectContaining({
					commentId: "c_bulk_refresh_1",
					ipLocationError: "xdb_not_found",
				}),
				expect.objectContaining({
					commentId: "c_bulk_refresh_2",
					ipLocationError: "xdb_not_found",
				}),
			],
		});
	});

	it("bulk moves comments to trash and clears only trashed comments", async () => {
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
			pageKey: "post:bulk-trash",
			pageTitle: "Bulk Trash",
			pageUrl: "/posts/bulk-trash/",
			commentCount: 4,
			rootCommentCount: 4,
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:bulk-trash"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(comments).values([
			{
				id: "c_bulk_pending",
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: null,
				status: "pending",
				authorName: "Pending",
				contentRaw: "pending comment",
				contentHtml: "<p>pending comment</p>",
				replyCount: 0,
				voteUpCount: 0,
				voteDownCount: 0,
				createdAt: "2026-05-28T10:00:00.000Z",
				updatedAt: "2026-05-28T10:00:00.000Z",
			},
			{
				id: "c_bulk_approved",
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: null,
				status: "approved",
				authorName: "Approved",
				contentRaw: "approved comment",
				contentHtml: "<p>approved comment</p>",
				replyCount: 0,
				voteUpCount: 0,
				voteDownCount: 0,
				createdAt: "2026-05-28T10:01:00.000Z",
				updatedAt: "2026-05-28T10:01:00.000Z",
			},
			{
				id: "c_bulk_trash",
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
				createdAt: "2026-05-28T10:02:00.000Z",
				updatedAt: "2026-05-28T10:02:00.000Z",
			},
			{
				id: "c_bulk_spam",
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
				createdAt: "2026-05-28T10:03:00.000Z",
				updatedAt: "2026-05-28T10:03:00.000Z",
			},
		]);

		const bulkTrashResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/comments/bulk-trash",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				commentIds: ["c_bulk_pending", "c_bulk_approved"],
			},
		});
		expect(bulkTrashResponse.statusCode).toBe(200);
		expect(bulkTrashResponse.json()).toMatchObject({
			updatedCount: 2,
			comments: [
				{ id: "c_bulk_pending", status: "trash" },
				{ id: "c_bulk_approved", status: "trash" },
			],
		});

		const afterBulkTrash = await fixture.app.db
			.select()
			.from(comments)
			.where(
				inArray(comments.id, [
					"c_bulk_pending",
					"c_bulk_approved",
					"c_bulk_trash",
					"c_bulk_spam",
				]),
			);
		expect(
			Object.fromEntries(
				afterBulkTrash.map((comment) => [
					comment.id,
					{ status: comment.status, deletedAt: comment.deletedAt },
				]),
			),
		).toMatchObject({
			c_bulk_pending: { status: "trash", deletedAt: null },
			c_bulk_approved: { status: "trash", deletedAt: null },
			c_bulk_trash: { status: "trash", deletedAt: null },
			c_bulk_spam: { status: "spam", deletedAt: null },
		});

		const clearTrashResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/comments/trash/clear",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				siteKey: "fangyuan",
			},
		});
		expect(clearTrashResponse.statusCode).toBe(200);
		expect(clearTrashResponse.json()).toMatchObject({
			deletedCount: 3,
		});

		const afterClearTrash = await fixture.app.db
			.select()
			.from(comments)
			.where(
				inArray(comments.id, [
					"c_bulk_pending",
					"c_bulk_approved",
					"c_bulk_trash",
					"c_bulk_spam",
				]),
			);
		expect(
			Object.fromEntries(
				afterClearTrash.map((comment) => [comment.id, comment.deletedAt]),
			),
		).toMatchObject({
			c_bulk_spam: null,
		});
		for (const comment of afterClearTrash.filter(
			(comment) => comment.status === "trash",
		)) {
			expect(comment.deletedAt).not.toBeNull();
		}
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
			headers: {
				referer: "http://localhost:4321/post:moderation-statuses",
			},
		});
		expect(publicThread.statusCode).toBe(200);
		expect(publicThread.json().items).toEqual([]);
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
