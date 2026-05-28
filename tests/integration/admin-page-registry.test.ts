import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
	pageThreads,
	pendingPageCandidates,
	sitePageRegistry,
} from "../../src/db/schema";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin page registry", () => {
	it("approves pending candidates and merges pending PV into a page thread", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);

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
