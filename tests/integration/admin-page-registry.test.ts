import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
	pageThreads,
	pendingPageCandidates,
	pendingPageViewSessions,
	siteSettings,
	sitePageRegistry,
	sites,
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

async function enableTrustedPageViews(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
) {
	await fixture.app.db.update(siteSettings).set({
		engagementJson: serializeEngagementSettings({
			visitors: { enabled: true },
			pageViews: { enabled: true },
			pageLikes: { enabled: false },
			commentVotes: { enabled: false },
		}),
	});
}

describe("admin page registry", () => {
	it("does not list registered pages as pending unknown pages", async () => {
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
			pageKey: "posts/already-registered-pending/",
			pageUrl: "/posts/already-registered-pending/",
			status: "active",
		});
		await fixture.app.db.insert(pendingPageCandidates).values({
			siteKey: "fangyuan",
			pageKey: "posts/already-registered-pending/",
			pageUrl: "/posts/already-registered-pending/",
			hitCount: 2,
			status: "pending",
		});
		await fixture.app.db.insert(pendingPageCandidates).values({
			siteKey: "fangyuan",
			pageKey: "posts/actually-unknown/",
			pageUrl: "/posts/actually-unknown/",
			hitCount: 1,
			status: "pending",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/page-registry/pending?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: admin.adminCookie.value,
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			items: [
				{
					siteKey: "fangyuan",
					pageKey: "posts/actually-unknown/",
					status: "pending",
				},
			],
			pagination: {
				totalCount: 1,
			},
		});
	});

	it("lists, rejects and ignores pending page candidates", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);
		await enableTrustedPageViews(fixture);

		await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageTitle=Pending",
			headers: {
				referer: "http://localhost:4321/posts/pending-review/",
				"user-agent": "pending-review-test",
			},
		});

		const listResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/page-registry/pending?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: admin.adminCookie.value,
			},
		});

		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.json()).toMatchObject({
			items: [
				{
					siteKey: "fangyuan",
					pageKey: "posts/pending-review/",
					pageUrl: "/posts/pending-review/",
					hitCount: 1,
					status: "pending",
				},
			],
			pagination: {
				totalCount: 1,
			},
		});

		const rejectResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/page-registry/pending/reject",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
				pageKey: "posts/pending-review/",
				reason: "not a content page",
			},
		});

		expect(rejectResponse.statusCode).toBe(200);
		expect(rejectResponse.json()).toMatchObject({
			candidate: {
				siteKey: "fangyuan",
				pageKey: "posts/pending-review/",
				status: "rejected",
				lastRejectReason: "not a content page",
			},
		});

		await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageTitle=Ignored",
			headers: {
				referer: "http://localhost:4321/posts/ignored-page/",
				"user-agent": "ignored-page-test",
			},
		});

		const ignoreResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/page-registry/pending/ignore",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
				pageKey: "posts/ignored-page/",
				reason: "utility route",
			},
		});

		expect(ignoreResponse.statusCode).toBe(200);
		expect(ignoreResponse.json()).toMatchObject({
			candidate: {
				siteKey: "fangyuan",
				pageKey: "posts/ignored-page/",
				status: "ignored",
				lastRejectReason: "utility route",
			},
			page: {
				siteKey: "fangyuan",
				pageKey: "posts/ignored-page/",
				status: "ignored",
			},
		});
		const [registryPage] = await fixture.app.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "posts/ignored-page/"));
		expect(registryPage).toMatchObject({
			status: "ignored",
			pageUrl: "/posts/ignored-page/",
		});

		const beforePendingSessionCount = (
			await fixture.app.db.select().from(pendingPageViewSessions)
		).length;
		await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageTitle=Ignored",
			headers: {
				referer: "http://localhost:4321/posts/ignored-page/",
				"user-agent": "ignored-page-test-2",
			},
		});
		expect(
			(await fixture.app.db.select().from(pendingPageViewSessions)).length,
		).toBe(beforePendingSessionCount);
	});

	it("approves pending candidates and merges pending PV into a page thread", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);
		await enableTrustedPageViews(fixture);

		await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageTitle=Pending",
			headers: {
				referer: "http://localhost:4321/posts/pending-approval/",
				"user-agent": "pending-approval-test",
			},
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/page-registry/pending/approve",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
				pageKey: "posts/pending-approval/",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			page: {
				siteKey: "fangyuan",
				pageKey: "posts/pending-approval/",
				status: "active",
				mergedPageViews: 1,
			},
		});
		const [registryPage] = await fixture.app.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "posts/pending-approval/"));
		expect(registryPage).toMatchObject({
			pageKey: "posts/pending-approval/",
			pageUrl: "/posts/pending-approval/",
			status: "active",
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "posts/pending-approval/"));
		expect(thread).toMatchObject({
			pageKey: "posts/pending-approval/",
			pageUrl: "/posts/pending-approval/",
			pageViewCount: 1,
		});
		const [candidate] = await fixture.app.db
			.select()
			.from(pendingPageCandidates)
			.where(eq(pendingPageCandidates.pageKey, "posts/pending-approval/"));
		expect(candidate).toMatchObject({
			status: "approved",
		});
	});
});
