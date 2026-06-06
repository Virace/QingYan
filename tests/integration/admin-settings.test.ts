import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { scheduledTasks, siteSettings, sites } from "../../src/db/schema";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin settings", () => {
	it("reads and updates site settings", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const getResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(getResponse.statusCode).toBe(200);
		expect(getResponse.json()).toMatchObject({
			siteKey: "fangyuan",
			comments: {
				enabled: true,
				defaultStatus: "pending",
				identity: {
					allow: ["nickname", "email", "website"],
					require: ["nickname", "email"],
				},
				captcha: {
					mode: "threshold",
					thresholdWindowSec: 60,
					thresholdMaxActions: 3,
				},
				moderation: {
					mode: "manual",
					provider: "none",
					akismet: {
						failPolicy: "pending",
						discardBlatantSpam: false,
					},
				},
				abuseGuard: {
					enabled: true,
					windowSec: 600,
					maxWriteActions: 100,
					autoBlacklist: {
						enabled: true,
						scope: "post",
						ttlSec: 1800,
					},
				},
				metadata: {
					collectIp: true,
					collectUserAgent: true,
					ipRegion: {
						enabled: false,
						precision: "province",
					},
					device: {
						enabled: true,
						display: {
							enabled: false,
						},
					},
				},
			},
			engagement: {
				visitors: {
					enabled: true,
				},
				pageViews: {
					enabled: true,
				},
				pageLikes: {
					enabled: true,
				},
				commentVotes: {
					enabled: true,
				},
			},
			pageRegistry: {
				mode: "discovery",
				authoritativeSitemapUrls: [],
				unknownPageResponse: "inactive_payload",
				requireHealthySource: true,
				sourceFreshnessGraceSec: 7200,
				emergencyLockdown: false,
			},
		});

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				comments: {
					defaultStatus: "approved",
					identity: {
						require: ["nickname"],
					},
					captcha: {
						mode: "always",
						thresholdWindowSec: 120,
						thresholdMaxActions: 4,
					},
					abuseGuard: {
						enabled: true,
						windowSec: 900,
						maxWriteActions: 120,
						autoBlacklist: {
							enabled: true,
							scope: "all",
							ttlSec: 2400,
						},
					},
					metadata: {
						collectIp: false,
						collectUserAgent: false,
						ipRegion: {
							enabled: true,
							precision: "city",
						},
						device: {
							enabled: false,
							display: {
								enabled: true,
							},
						},
					},
					moderation: {
						mode: "manual_with_akismet",
						provider: "akismet",
						akismet: {
							failPolicy: "pending",
							discardBlatantSpam: false,
						},
					},
				},
				pageFeedback: {
					allowLike: false,
				},
				notifications: {
					commenter: {
						replyEmailEnabled: true,
					},
					backend: {
						enabled: true,
					},
				},
				engagement: {
					visitors: {
						enabled: false,
					},
					pageViews: {
						enabled: true,
					},
					pageLikes: {
						enabled: true,
					},
					commentVotes: {
						enabled: true,
					},
				},
			},
		});
		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json()).toMatchObject({
			comments: {
				defaultStatus: "approved",
				identity: {
					allow: ["nickname", "email", "website"],
					require: ["nickname"],
				},
				captcha: {
					mode: "always",
					thresholdWindowSec: 120,
					thresholdMaxActions: 4,
				},
				abuseGuard: {
					enabled: true,
					windowSec: 900,
					maxWriteActions: 120,
					autoBlacklist: {
						enabled: true,
						scope: "all",
						ttlSec: 2400,
					},
				},
				metadata: {
					collectIp: false,
					collectUserAgent: false,
					ipRegion: {
						enabled: true,
						precision: "city",
					},
					device: {
						enabled: false,
						display: {
							enabled: true,
						},
					},
				},
				moderation: {
					mode: "manual_with_akismet",
					provider: "akismet",
					akismet: {
						failPolicy: "pending",
						discardBlatantSpam: false,
					},
				},
			},
			pageFeedback: {
				allowLike: true,
			},
			notifications: {
				commenter: {
					replyEmailEnabled: true,
				},
				backend: {
					enabled: true,
				},
			},
			engagement: {
				visitors: {
					enabled: false,
				},
				pageViews: {
					enabled: true,
				},
				pageLikes: {
					enabled: true,
				},
				commentVotes: {
					enabled: true,
				},
			},
		});
	});

	it("updates one engagement switch without erasing sibling switches", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				engagement: {
					visitors: {
						enabled: false,
					},
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json().engagement).toEqual({
			visitors: {
				enabled: false,
			},
			pageViews: {
				enabled: true,
			},
			pageLikes: {
				enabled: true,
			},
			commentVotes: {
				enabled: true,
			},
		});

		const secondUpdateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				engagement: {
					pageViews: {
						enabled: true,
					},
				},
			},
		});

		expect(secondUpdateResponse.statusCode).toBe(200);
		expect(secondUpdateResponse.json().engagement).toEqual({
			visitors: {
				enabled: false,
			},
			pageViews: {
				enabled: true,
			},
			pageLikes: {
				enabled: true,
			},
			commentVotes: {
				enabled: true,
			},
		});
	});

	it("persists page registry settings patches", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				pageRegistry: {
					unknownPageResponse: "forbidden",
					sourceFreshnessGraceSec: 3600,
					emergencyLockdown: true,
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json().pageRegistry).toEqual({
			mode: "discovery",
			authoritativeSitemapUrls: [],
			unknownPageResponse: "forbidden",
			requireHealthySource: true,
			sourceFreshnessGraceSec: 3600,
			emergencyLockdown: true,
		});

		const readResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(readResponse.statusCode).toBe(200);
		expect(readResponse.json().pageRegistry.unknownPageResponse).toBe(
			"forbidden",
		);
	});

	it("ensures and disables protected page source refresh tasks for authoritative mode", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				pageRegistry: {
					mode: "authoritative",
					authoritativeSitemapUrls: ["http://localhost:4321/sitemap.xml"],
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json().pageRegistry).toMatchObject({
			mode: "authoritative",
			authoritativeSitemapUrls: ["http://localhost:4321/sitemap.xml"],
			requireHealthySource: true,
		});
		const tasksAfterEnable = await fixture.app.db
			.select()
			.from(scheduledTasks)
			.where(
				eq(
					scheduledTasks.systemKey,
					"page_registry:authoritative_source_refresh:fangyuan",
				),
			);
		expect(tasksAfterEnable).toHaveLength(1);
		expect(tasksAfterEnable[0]).toMatchObject({
			type: "page_source_refresh",
			enabled: true,
			protectionJson: expect.any(String),
			payloadJson: expect.any(String),
		});
		expect(JSON.parse(tasksAfterEnable[0].payloadJson)).toMatchObject({
			siteKey: "fangyuan",
			sitemapUrls: ["http://localhost:4321/sitemap.xml"],
			mode: "replace",
		});

		const repeatResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				pageRegistry: {
					mode: "authoritative",
					authoritativeSitemapUrls: ["http://localhost:4321/other.xml"],
				},
			},
		});
		expect(repeatResponse.statusCode).toBe(200);
		const tasksAfterRepeat = await fixture.app.db
			.select()
			.from(scheduledTasks)
			.where(
				eq(
					scheduledTasks.systemKey,
					"page_registry:authoritative_source_refresh:fangyuan",
				),
			);
		expect(tasksAfterRepeat).toHaveLength(1);
		expect(JSON.parse(tasksAfterRepeat[0].payloadJson)).toMatchObject({
			siteKey: "fangyuan",
			sitemapUrls: ["http://localhost:4321/other.xml"],
			mode: "replace",
		});

		const disableResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				pageRegistry: {
					mode: "discovery",
				},
			},
		});
		expect(disableResponse.statusCode).toBe(200);
		const [releasedTask] = await fixture.app.db
			.select()
			.from(scheduledTasks)
			.where(eq(scheduledTasks.id, tasksAfterEnable[0].id));
		expect(releasedTask).toMatchObject({
			systemKey: "page_registry:authoritative_source_refresh:fangyuan",
			enabled: false,
			disabledReason: "authoritative_disabled",
			protectionJson: expect.any(String),
		});

		const reenableResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				pageRegistry: {
					mode: "authoritative",
					authoritativeSitemapUrls: ["http://localhost:4321/sitemap.xml"],
				},
			},
		});
		expect(reenableResponse.statusCode).toBe(200);
		const tasksAfterReenable = await fixture.app.db
			.select()
			.from(scheduledTasks)
			.where(
				eq(
					scheduledTasks.systemKey,
					"page_registry:authoritative_source_refresh:fangyuan",
				),
			);
		expect(tasksAfterReenable).toHaveLength(1);
		expect(tasksAfterReenable[0]).toMatchObject({
			id: tasksAfterEnable[0].id,
			enabled: true,
			protectionJson: expect.any(String),
		});
	});

	it("rejects authoritative mode without sitemap URLs", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				pageRegistry: {
					mode: "authoritative",
					authoritativeSitemapUrls: [],
				},
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "VALIDATION_FAILED",
				fields: [
					{
						path: "pageRegistry.authoritativeSitemapUrls",
						code: "AUTHORITATIVE_SOURCE_REQUIRED",
					},
				],
			},
		});
	});

	it("patches one site settings section without erasing sibling sections", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/settings/fangyuan/sections/engagement",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				visitors: {
					enabled: false,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			siteKey: "fangyuan",
			comments: {
				enabled: true,
				defaultStatus: "pending",
			},
			engagement: {
				visitors: {
					enabled: false,
				},
				pageViews: {
					enabled: true,
				},
				pageLikes: {
					enabled: true,
				},
				commentVotes: {
					enabled: true,
				},
			},
		});

		const readResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(readResponse.statusCode).toBe(200);
		expect(readResponse.json().engagement.visitors.enabled).toBe(false);
		expect(readResponse.json().comments.defaultStatus).toBe("pending");
	});

	it("rejects unknown site settings sections", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/settings/fangyuan/sections/security",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				enabled: false,
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "VALIDATION_FAILED",
			},
		});
	});

	it("reads site settings for the dev default site", async () => {
		const fixture = await createTestApp({ devMode: true });
		cleanups.push(fixture.cleanup);
		const { adminCookie } = await loginAsAdmin(fixture.app, {
			password: "admin",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/default/settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			siteKey: "default",
			comments: {
				enabled: true,
				defaultStatus: "pending",
				moderation: {
					mode: "manual",
				},
			},
		});
	});

	it("persists site settings for the dev default site", async () => {
		const fixture = await createTestApp({ devMode: true });
		cleanups.push(fixture.cleanup);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			password: "admin",
		});

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/default/settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
				origin: fixture.runtimeOptions.devMode.adminOrigin,
			}),
			payload: {
				comments: {
					enabled: false,
				},
			},
		});
		expect(updateResponse.statusCode).toBe(200);

		const readResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/default/settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(readResponse.statusCode).toBe(200);
		expect(readResponse.json()).toMatchObject({
			siteKey: "default",
			comments: {
				enabled: false,
			},
		});
	});

	it("rejects legacy per-site Akismet blog URL settings", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				comments: {
					moderation: {
						mode: "manual_with_akismet",
						provider: "akismet",
						akismet: {
							blogUrl: "https://fangyuan.example.com",
							failPolicy: "pending",
							discardBlatantSpam: false,
						},
					},
				},
			},
		});

		expect(response.statusCode).toBe(400);
	});

	it("does not expose the legacy admin settings route", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/settings?siteKey=fangyuan",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(404);
	});

	it("normalizes legacy numeric booleans on settings read", async () => {
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
				commentMetadataJson: JSON.stringify({
					collectIp: 0,
					collectUserAgent: 1,
					ipRegion: {
						enabled: 1,
						precision: "city",
					},
					device: {
						enabled: 0,
						display: {
							enabled: 1,
						},
					},
				}),
				engagementJson: JSON.stringify({
					visitors: { enabled: 1 },
					pageViews: { enabled: 0 },
					pageLikes: { enabled: 1 },
					commentVotes: { enabled: 0 },
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().comments.metadata).toMatchObject({
			collectIp: false,
			collectUserAgent: true,
			ipRegion: {
				enabled: true,
				precision: "city",
			},
			device: {
				enabled: false,
				display: {
					enabled: true,
				},
			},
		});
		expect(response.json().engagement).toEqual({
			visitors: { enabled: true },
			pageViews: { enabled: false },
			pageLikes: { enabled: true },
			commentVotes: { enabled: false },
		});
	});

	it("rejects numeric booleans in settings writes with field errors", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				engagement: {
					commentVotes: {
						enabled: 1,
					},
				},
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "VALIDATION_FAILED",
				message: "请求参数无效。",
				fields: [
					{
						path: "engagement.commentVotes.enabled",
						code: "invalid_type",
						expected: "boolean",
						received: "number",
						message: "必须是 JSON boolean，不能使用 0/1。",
					},
				],
			},
		});
		expect(response.json().error).toHaveProperty("requestId");
	});
});
