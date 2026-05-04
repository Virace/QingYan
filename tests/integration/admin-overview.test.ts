import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
	blacklistRules,
	comments,
	pageThreads,
	sites,
	visitors,
} from "../../src/db/schema";
import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin overview", () => {
	it("requires an admin session", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/overview",
		});

		expect(response.statusCode).toBe(401);
	});

	it("returns dashboard stats and runtime summary", async () => {
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

		await fixture.app.db.insert(visitors).values({
			siteId: site.id,
			visitorKey: "visitor_overview_1",
		});
		const [visitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "visitor_overview_1"));
		if (!visitor) {
			throw new Error("Expected visitor to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:overview",
			pageTitle: "Overview",
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:overview"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(comments).values([
			{
				id: "c_overview_pending",
				siteId: site.id,
				pageThreadId: thread.id,
				visitorId: visitor.id,
				status: "pending",
				authorName: "Alice",
				authorEmail: "alice@example.com",
				contentRaw: "pending",
				contentHtml: "<p>pending</p>",
			},
			{
				id: "c_overview_approved",
				siteId: site.id,
				pageThreadId: thread.id,
				visitorId: visitor.id,
				status: "approved",
				authorName: "Bob",
				authorEmail: "bob@example.com",
				contentRaw: "approved",
				contentHtml: "<p>approved</p>",
			},
		]);
		await fixture.app.db.insert(blacklistRules).values({
			scope: "all",
			targetType: "visitor",
			targetValue: "visitor_overview_1",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/overview",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			console: {
				path: "/admin",
			},
			runtime: {
				devMode: false,
			},
			stats: {
				siteCount: 1,
				pageCount: 1,
				commentCount: 2,
				pendingCommentCount: 1,
				userCount: 2,
				visitorCount: 1,
				blacklistRuleCount: 1,
			},
			logging: {
				level: "info",
				retentionDays: 7,
				directory: fixture.logsDirectory,
			},
		});
	});
});
