import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	comments,
	pageThreads,
	siteSettings,
	sites,
	visitors,
} from "../../src/db/schema";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin sites", () => {
	it("rejects allowed origins that include a path", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const response = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/sites/fangyuan",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				allowedOrigins: ["https://new.example.com/path"],
			},
		});

		expect(response.statusCode).toBe(400);
	});

	it("creates a site with default site settings", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/sites",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
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
			.from(siteSettings)
			.where(eq(siteSettings.siteId, site?.id ?? 0));
		expect(settings).toMatchObject({
			commentsEnabled: true,
			defaultStatus: "pending",
			rootLimit: 20,
		});

		const settingsResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/docs/settings",
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
				verifiedAuthor: {
					enabled: true,
					displayName: "管理员",
					email: "",
					website: "",
					badgeLabel: "管理员",
				},
			},
		});
	});

	it("updates verified author settings per site", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const response = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				comments: {
					verifiedAuthor: {
						enabled: true,
						displayName: "Virace",
						email: "Owner@Example.COM",
						website: "https://fangyuan.example.com/about",
						badgeLabel: "楼主",
					},
				},
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().comments.verifiedAuthor).toEqual({
			enabled: true,
			displayName: "Virace",
			email: "owner@example.com",
			website: "https://fangyuan.example.com/about",
			badgeLabel: "楼主",
		});
	});

	it("updates site name and allowed origins", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const response = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/sites/fangyuan",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				name: "FangYuan Updated",
				allowedOrigins: ["https://new.example.com"],
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			items: expect.arrayContaining([
				expect.objectContaining({
					siteKey: "fangyuan",
					name: "FangYuan Updated",
					allowedOrigins: ["https://new.example.com"],
				}),
			]),
		});
		expect(
			fixture.app.siteRegistry.getRegisteredSite("fangyuan"),
		).toMatchObject({
			name: "FangYuan Updated",
			allowedOrigins: ["https://new.example.com"],
		});
	});

	it("loads sites from DB without overwriting them from startup config", async () => {
		const fixture = await createTestApp({
			seedSite: {
				siteKey: "fangyuan",
				name: "FangYuan DB",
				allowedOrigins: ["http://db.example.test"],
			},
		});
		cleanups.push(fixture.cleanup);

		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		expect(site).toMatchObject({
			name: "FangYuan DB",
			allowedOriginsJson: '["http://db.example.test"]',
		});

		const [settings] = await fixture.app.db
			.select()
			.from(siteSettings)
			.where(eq(siteSettings.siteId, site?.id ?? 0));
		expect(settings).toMatchObject({
			rootLimit: 20,
		});

		expect(
			fixture.app.siteRegistry.getRegisteredSite("fangyuan"),
		).toMatchObject({
			name: "FangYuan DB",
			allowedOrigins: ["http://db.example.test"],
		});
	});

	it("lists site summaries with site settings and counts", async () => {
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
			url: "/qingyan/api/admin/sites",
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
