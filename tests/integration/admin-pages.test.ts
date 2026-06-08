import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
	adminUsers,
	comments,
	delayedDeletions,
	pageThreads,
	pageViewSessions,
	sitePageRegistry,
	siteSettings,
	sites,
	systemSettings,
	taskRuns,
	visitors,
} from "../../src/db/schema";
import { serializeEngagementSettings } from "../../src/modules/shared/site-settings-defaults";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin pages", () => {
	it("lists page management aggregates", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		const [adminUser] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));
		if (!site || !adminUser) {
			throw new Error("Expected site and admin user to exist");
		}

		await fixture.app.db.insert(visitors).values({
			siteId: site.id,
			visitorKey: "visitor_pages_1",
		});
		const [visitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "visitor_pages_1"));
		if (!visitor) {
			throw new Error("Expected visitor to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:welcome",
			pageTitle: "Welcome",
			pageUrl: "/posts/welcome/",
			commentCount: 1,
			rootCommentCount: 1,
			pageLikeCount: 2,
			updatedAt: "2026-04-17T10:00:00.000Z",
		});
		await fixture.app.db.insert(sitePageRegistry).values({
			siteId: site.id,
			pageKey: "post:welcome",
			pageUrl: "/posts/welcome/",
			title: "Welcome",
			status: "active",
			updatedAt: "2026-04-17T10:00:00.000Z",
		});
		await fixture.app.db.insert(sitePageRegistry).values({
			siteId: site.id,
			pageKey: "post:registry-only",
			pageUrl: "/posts/registry-only/",
			title: "Registry Only",
			status: "active",
			updatedAt: "2026-04-18T10:00:00.000Z",
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:welcome"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(pageViewSessions).values({
			pageThreadId: thread.id,
			visitorId: visitor.id,
			fingerprint: "page-fingerprint-1",
			seenAt: "2026-04-17T10:00:00.000Z",
		});
		await fixture.app.db.insert(comments).values({
			id: "c_pages_1",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: null,
			visitorId: visitor.id,
			status: "approved",
			authorName: "Alice",
			authorEmail: "alice@example.com",
			contentRaw: "hello page",
			contentHtml: "<p>hello page</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-04-17T10:00:00.000Z",
			updatedAt: "2026-04-17T10:00:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/pages?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			items: [
				{
					pageKey: "post:registry-only",
					status: "active",
					pageTitle: "Registry Only",
					pageUrl: "http://localhost:4321/posts/registry-only/",
					commentCount: 0,
					rootCommentCount: 0,
					pageLikeCount: 0,
					visitorCount: 0,
					commenterCount: 0,
				},
				{
					pageKey: "post:welcome",
					status: "active",
					pageTitle: "Welcome",
					pageUrl: "http://localhost:4321/posts/welcome/",
					commentCount: 1,
					rootCommentCount: 1,
					pageLikeCount: 2,
					visitorCount: 1,
					commenterCount: 1,
				},
			],
			pagination: {
				totalCount: 2,
			},
		});
	});

	it("marks page counters as lightweight when visitor records are disabled", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		const [adminUser] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));
		if (!site || !adminUser) {
			throw new Error("Expected site and admin user to exist");
		}
		await fixture.app.db.update(siteSettings).set({
			engagementJson: serializeEngagementSettings({
				visitors: { enabled: false },
				pageViews: { enabled: true },
				pageLikes: { enabled: true },
				commentVotes: { enabled: true },
			}),
		});
		await fixture.app.db.insert(sitePageRegistry).values({
			siteId: site.id,
			pageKey: "post:lightweight-page",
			pageUrl: "/posts/lightweight-page/",
			status: "active",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/pages?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().items[0].engagement).toMatchObject({
			trustMode: "lightweight",
			visitorsEnabled: false,
			pageViewsEnabled: true,
			pageLikesEnabled: true,
			commentVotesEnabled: true,
		});
	});

	it("sorts page management rows by whitelisted fields", async () => {
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

		await fixture.app.db.insert(pageThreads).values([
			{
				siteId: site.id,
				pageKey: "post:beta",
				pageTitle: "Beta",
				pageUrl: "/posts/beta/",
				commentCount: 2,
			},
			{
				siteId: site.id,
				pageKey: "post:alpha",
				pageTitle: "Alpha",
				pageUrl: "/posts/alpha/",
				commentCount: 5,
			},
		]);
		await fixture.app.db.insert(sitePageRegistry).values([
			{
				siteId: site.id,
				pageKey: "post:beta",
				pageUrl: "/posts/beta/",
				title: "Beta",
				status: "active",
				updatedAt: "2026-05-30T00:00:01.000Z",
			},
			{
				siteId: site.id,
				pageKey: "post:alpha",
				pageUrl: "/posts/alpha/",
				title: "Alpha",
				status: "active",
				updatedAt: "2026-05-30T00:00:02.000Z",
			},
		]);

		const byTitle = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/pages?siteKey=fangyuan&sortBy=title&sortOrder=asc&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(byTitle.statusCode).toBe(200);
		expect(
			(byTitle.json() as { items: Array<{ pageTitle: string }> }).items.map(
				(item) => item.pageTitle,
			),
		).toEqual(["Alpha", "Beta"]);

		const byCommentCount = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/pages?siteKey=fangyuan&sortBy=commentCount&sortOrder=desc&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(byCommentCount.statusCode).toBe(200);
		expect(
			(byCommentCount.json() as { items: Array<{ commentCount: number }> })
				.items[0].commentCount,
		).toBe(5);

		const invalidSort = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/pages?siteKey=fangyuan&sortBy=__proto__&sortOrder=desc",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(invalidSort.statusCode).toBe(400);
	});

	it("filters page status and moves pages through trash restore and deleted lifecycle", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		await fixture.app.db.insert(sitePageRegistry).values({
			siteId: site.id,
			pageKey: "post:lifecycle",
			pageUrl: "/posts/lifecycle/",
			title: "Lifecycle",
			status: "active",
			updatedAt: "2026-05-29T00:00:00.000Z",
		});

		const trashResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/pages/post%3Alifecycle/trash",
			...withAdminWriteAuth(admin),
		});
		expect(trashResponse.statusCode).toBe(200);
		expect(trashResponse.json()).toMatchObject({
			page: {
				siteKey: "fangyuan",
				pageKey: "post:lifecycle",
				status: "trash",
			},
		});

		const trashList = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/pages?siteKey=fangyuan&status=trash&limit=20&offset=0",
			cookies: {
				qingyan_admin: admin.adminCookie.value,
			},
		});
		expect(trashList.statusCode).toBe(200);
		expect(trashList.json()).toMatchObject({
			items: [
				{
					pageKey: "post:lifecycle",
					status: "trash",
					trashedAt: expect.any(String),
				},
			],
			pagination: {
				totalCount: 1,
			},
		});

		const restoreResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/pages/post%3Alifecycle/restore",
			...withAdminWriteAuth(admin),
		});
		expect(restoreResponse.statusCode).toBe(200);
		expect(restoreResponse.json()).toMatchObject({
			page: {
				pageKey: "post:lifecycle",
				status: "active",
				trashedAt: null,
			},
		});

		const deleteResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/pages/post%3Alifecycle/delete",
			...withAdminWriteAuth(admin),
		});
		expect(deleteResponse.statusCode).toBe(200);
		expect(deleteResponse.json()).toMatchObject({
			page: {
				pageKey: "post:lifecycle",
				status: "deleted",
				deletedAt: expect.any(String),
			},
		});
	});

	it("creates a pending delayed deletion record when deleting a page with retained deletion policy", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		const [adminUser] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));
		if (!site || !adminUser) {
			throw new Error("Expected site and admin user to exist");
		}
		await fixture.app.db.insert(sitePageRegistry).values({
			siteId: site.id,
			pageKey: "post:delayed-delete",
			pageUrl: "/posts/delayed-delete/",
			title: "Delayed Delete",
			status: "active",
		});

		const deleteResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/pages/post%3Adelayed-delete/delete",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
			},
		});

		expect(deleteResponse.statusCode).toBe(200);
		expect(deleteResponse.json()).toMatchObject({
			page: {
				pageKey: "post:delayed-delete",
				status: "deleted",
				deletion: {
					mode: "delayed",
					hardDeleteAfter: expect.any(String),
				},
			},
		});
		const [record] = await fixture.app.db
			.select()
			.from(delayedDeletions)
			.where(eq(delayedDeletions.resourceId, "post:delayed-delete"));
		expect(record).toMatchObject({
			resourceType: "page",
			resourceId: "post:delayed-delete",
			siteId: site.id,
			status: "pending",
			requestedByUserId: adminUser.id,
		});
		expect(JSON.parse(record?.metadataJson ?? "{}")).toMatchObject({
			pageKey: "post:delayed-delete",
			siteKey: "fangyuan",
		});
	});

	it("hard deletes page trash immediately when deletion retention is zero", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}
		await fixture.app.db.insert(systemSettings).values({
			category: "admin",
			key: "deletion.retentionDays",
			valueJson: "0",
		});
		await fixture.app.db.insert(sitePageRegistry).values([
			{
				siteId: site.id,
				pageKey: "post:trash-immediate-a",
				pageUrl: "/posts/trash-immediate-a/",
				status: "trash",
				trashedAt: "2026-06-01T00:00:00.000Z",
			},
			{
				siteId: site.id,
				pageKey: "post:trash-immediate-b",
				pageUrl: "/posts/trash-immediate-b/",
				status: "trash",
				trashedAt: "2026-06-01T00:00:00.000Z",
			},
		]);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/pages/trash/clear",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			deletedCount: 2,
			deletion: {
				mode: "immediate",
				resourceCount: 2,
			},
		});
		const remaining = await fixture.app.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.siteId, site.id));
		expect(remaining).toEqual([]);
	});

	it("creates a page title refresh job for one page", async () => {
		const fixture = await createTestApp({
			pageTitleFetchHtml: async () => ({
				status: 200,
				text: "<title>Fresh Title</title>",
			}),
		});
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}
		await fixture.app.db.insert(sitePageRegistry).values({
			siteId: site.id,
			pageKey: "post:title-refresh",
			pageUrl: "/posts/title-refresh/",
			title: null,
			status: "active",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/pages/post%3Atitle-refresh/title/refresh",
			...withAdminWriteAuth(admin),
			payload: { siteKey: "fangyuan" },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			run: {
				type: "page_metadata_refresh",
				status: "queued",
				siteKey: "fangyuan",
				input: {
					siteKey: "fangyuan",
					pageKeys: ["post:title-refresh"],
					scope: "force",
					trigger: "manual",
				},
			},
		});
		const [run] = await fixture.app.db
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.type, "page_metadata_refresh"));
		expect(run).toMatchObject({
			type: "page_metadata_refresh",
			status: "queued",
			siteKey: "fangyuan",
		});
	});
});
