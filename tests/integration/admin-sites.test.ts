import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	comments,
	pageThreads,
	runtimeSettings,
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

describe("admin sites", () => {
	it("creates a site with default runtime settings", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/sites",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
			payload: {
				siteKey: "docs",
				name: "Docs",
				allowedOrigins: ["http://localhost:4322"],
			},
		});

		expect(createResponse.statusCode).toBe(200);
		expect(createResponse.json()).toMatchObject({
			items: expect.arrayContaining([
				expect.objectContaining({
					siteKey: "docs",
					name: "Docs",
					allowedOrigins: ["http://localhost:4322"],
					comments: expect.objectContaining({
						enabled: true,
						defaultStatus: "pending",
					}),
				}),
			]),
		});

		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "docs"));
		expect(site).toMatchObject({
			siteKey: "docs",
			name: "Docs",
			allowedOriginsJson: '["http://localhost:4322"]',
		});

		const [settings] = await fixture.app.db
			.select()
			.from(runtimeSettings)
			.where(eq(runtimeSettings.siteId, site?.id ?? 0));
		expect(settings).toMatchObject({
			commentsEnabled: true,
			defaultStatus: "pending",
			rootLimit: 20,
		});

		const settingsResponse = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/settings?siteKey=docs",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(settingsResponse.statusCode).toBe(200);
		expect(settingsResponse.json()).toMatchObject({
			siteKey: "docs",
			comments: {
				enabled: true,
				rootLimit: 20,
			},
		});
	});

	it("lists site summaries with runtime settings and counts", async () => {
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
			visitorKey: "visitor_site_1",
		});
		const [visitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "visitor_site_1"));
		if (!visitor) {
			throw new Error("Expected visitor to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:site-summary",
			pageTitle: "Site Summary",
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:site-summary"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(comments).values({
			id: "c_site_1",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: null,
			visitorId: visitor.id,
			status: "approved",
			authorName: "Alice",
			authorEmail: "alice@example.com",
			contentRaw: "site summary comment",
			contentHtml: "<p>site summary comment</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-04-17T10:00:00.000Z",
			updatedAt: "2026-04-17T10:00:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/sites",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			items: [
				{
					siteKey: "fangyuan",
					name: "FangYuan",
					allowedOrigins: ["http://localhost:4321"],
					comments: {
						enabled: true,
						defaultStatus: "pending",
						identity: {
							require: ["nickname", "email"],
						},
						captcha: {
							mode: "threshold",
						},
					},
					pageFeedback: {
						allowLike: true,
					},
					notifications: {
						emailEnabled: false,
					},
					pageCount: 1,
					commentCount: 1,
					userCount: 1,
					visitorCount: 1,
				},
			],
		});
	});
});
