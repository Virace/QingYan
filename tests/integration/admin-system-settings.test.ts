import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	adminUsers,
	auditLogs,
	notificationChannelConfigs,
	siteNotificationRecipientRoutes,
	siteNotificationRecipients,
	sites,
} from "../../src/db/schema";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin system settings", () => {
	it("reads and updates global logging settings", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const [adminUser] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));
		if (!adminUser) {
			throw new Error("Expected admin user to exist");
		}

		const getResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/system-settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(getResponse.statusCode).toBe(200);
		expect(getResponse.json()).toMatchObject({
			logging: {
				level: "info",
				retentionDays: 7,
				directory: fixture.logsDirectory,
			},
			mail: {
				enabled: false,
				smtp: {
					passwordConfigured: false,
				},
			},
			captcha: {
				provider: "image",
				image: {
					width: 160,
					height: 60,
					ttlSec: 600,
				},
			},
			ipRegion: {
				enabled: false,
				cachePolicy: "vectorIndex",
				precision: "province",
			},
			avatar: {
				external: {
					enabled: false,
					baseUrl: "https://gravatar.com/avatar",
					hashAlgorithm: "sha256",
					query: "s=80&d=404&r=g",
				},
				display: {
					shape: "circle",
					sizePx: 40,
				},
			},
			publicApi: {
				advisoryFields: {
					enabled: false,
				},
			},
			antiSpam: {
				akismet: {
					apiKeyConfigured: false,
				},
			},
			security: {
				adminOriginGuard: {
					enabled: true,
					allowMissingOrigin: false,
					allowedOrigins: [],
				},
				publicOriginGuard: {
					enabled: true,
					allowMissingOrigin: true,
				},
				globalFloodGuard: {
					enabled: false,
					windowSec: 10,
					maxRequests: 120,
				},
			},
			admin: {
				session: {
					ttlMinutes: 4320,
				},
				emailVerification: {
					selfServiceRequired: true,
				},
				deletion: {
					retentionDays: 15,
				},
			},
		});

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "debug",
					retentionDays: 14,
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json()).toMatchObject({
			logging: {
				level: "debug",
				retentionDays: 14,
				directory: fixture.logsDirectory,
			},
		});
		expect(fixture.app.loggerManager.getRuntimeSettings()).toEqual({
			level: "debug",
			retentionDays: 14,
		});
		const audits = await fixture.app.db.select().from(auditLogs);
		expect(audits).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					actorType: "admin_user",
					actorId: String(adminUser.id),
					action: "system.settings.updated",
					targetType: "system_settings",
					targetId: "global",
				}),
			]),
		);
	});

	it("updates public API advisory field settings", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				publicApi: {
					advisoryFields: {
						enabled: true,
					},
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json()).toMatchObject({
			publicApi: {
				advisoryFields: {
					enabled: true,
				},
			},
		});

		const getResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/system-settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(getResponse.statusCode).toBe(200);
		expect(getResponse.json()).toMatchObject({
			publicApi: {
				advisoryFields: {
					enabled: true,
				},
			},
		});
	});

	it("rejects invalid system setting booleans with field errors", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				mail: {
					enabled: 1,
					smtp: {
						host: "",
						port: 587,
						secure: false,
						username: "",
						from: "",
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
						path: "mail.enabled",
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

	it("updates runtime security settings without rewriting startup config", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				security: {
					adminOriginGuard: {
						enabled: true,
						allowMissingOrigin: true,
						allowedOrigins: ["https://admin.example.test"],
					},
					publicOriginGuard: {
						enabled: true,
						allowMissingOrigin: true,
					},
					globalFloodGuard: {
						enabled: true,
						windowSec: 20,
						maxRequests: 240,
					},
					rateLimit: {
						adminLogin: {
							windowSec: 120,
							maxFailures: 3,
							autoBlacklistSec: 600,
						},
						commentCreate: {
							windowSec: 60,
							maxRequests: 2,
						},
						commentVote: {
							windowSec: 60,
							maxRequests: 4,
						},
						captchaVerify: {
							windowSec: 60,
							maxFailures: 3,
						},
						pageLike: {
							windowSec: 60,
							maxRequests: 5,
						},
					},
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json()).toMatchObject({
			security: {
				adminOriginGuard: {
					enabled: true,
					allowMissingOrigin: true,
					allowedOrigins: ["https://admin.example.test"],
				},
				publicOriginGuard: {
					enabled: true,
					allowMissingOrigin: true,
				},
				globalFloodGuard: {
					enabled: true,
					windowSec: 20,
					maxRequests: 240,
				},
				rateLimit: {
					adminLogin: {
						windowSec: 120,
						maxFailures: 3,
						autoBlacklistSec: 600,
					},
					commentCreate: {
						windowSec: 60,
						maxRequests: 2,
					},
					pageLike: {
						windowSec: 60,
						maxRequests: 5,
					},
				},
			},
		});
		expect(fixture.app.config.security.adminOriginGuard).toMatchObject({
			enabled: true,
			allowMissingOrigin: false,
			allowedOrigins: [],
		});

		const getResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/system-settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(getResponse.statusCode).toBe(200);
		expect(getResponse.json()).toMatchObject({
			security: {
				adminOriginGuard: {
					allowMissingOrigin: true,
					allowedOrigins: ["https://admin.example.test"],
				},
			},
		});
	});

	it("updates global mail captcha and IP settings without returning secrets", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				mail: {
					enabled: true,
					smtp: {
						host: "smtp.example.test",
						port: 587,
						secure: false,
						username: "notify@example.test",
						password: "smtp-secret",
						from: "notify@example.test",
					},
				},
				captcha: {
					provider: "turnstile",
					image: {
						width: 160,
						height: 60,
						ttlSec: 600,
					},
					turnstile: {
						siteKey: "turnstile-site-key",
						secretKey: "turnstile-secret",
						expectedAction: "COMMENT_SUBMIT",
						expectedHostname: "comments.example.test",
					},
				},
				ipRegion: {
					enabled: true,
					cachePolicy: "content",
					precision: "city",
					autoUpdate: {
						enabled: true,
						schedule: "monthly",
					},
					ipv4: {
						dbPath: "./data/custom-v4.xdb",
						sources: ["https://example.test/ip2region_v4.xdb"],
					},
					ipv6: {
						dbPath: "./data/custom-v6.xdb",
						sources: ["https://example.test/ip2region_v6.xdb"],
					},
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.body).not.toContain("smtp-secret");
		expect(updateResponse.body).not.toContain("turnstile-secret");
		const auditRows = await fixture.app.db.select().from(auditLogs);
		expect(JSON.stringify(auditRows)).not.toContain("smtp-secret");
		expect(updateResponse.json()).toMatchObject({
			mail: {
				enabled: true,
				smtp: {
					host: "smtp.example.test",
					passwordConfigured: true,
				},
			},
			captcha: {
				provider: "turnstile",
				turnstile: {
					siteKey: "turnstile-site-key",
					secretKeyConfigured: true,
					expectedAction: "COMMENT_SUBMIT",
				},
			},
			ipRegion: {
				enabled: true,
				cachePolicy: "content",
				precision: "city",
			},
		});

		const afterUpdate = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "debug",
					retentionDays: 14,
				},
				mail: {
					enabled: true,
					smtp: {
						host: "smtp2.example.test",
						port: 465,
						secure: true,
						username: "notify2@example.test",
						from: "notify2@example.test",
					},
				},
				captcha: {
					provider: "turnstile",
					image: {
						width: 180,
						height: 64,
						ttlSec: 300,
					},
					turnstile: {
						siteKey: "turnstile-site-key-2",
						expectedAction: "COMMENT_SUBMIT",
					},
				},
			},
		});

		expect(afterUpdate.statusCode).toBe(200);
		expect(afterUpdate.body).not.toContain("smtp-secret");
		expect(afterUpdate.body).not.toContain("turnstile-secret");
		expect(afterUpdate.json().mail.smtp.passwordConfigured).toBe(true);
		expect(afterUpdate.json().captcha.turnstile.secretKeyConfigured).toBe(true);
	});

	it("patches one system settings section while preserving sibling settings and blank secrets", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const seedResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				mail: {
					enabled: true,
					smtp: {
						host: "smtp.example.test",
						port: 587,
						secure: false,
						username: "notify@example.test",
						password: "smtp-secret",
						from: "notify@example.test",
					},
				},
			},
		});
		expect(seedResponse.statusCode).toBe(200);

		const patchResponse = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/system-settings/sections/mail",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				enabled: true,
				smtp: {
					host: "smtp2.example.test",
					port: 465,
					secure: true,
					username: "notify2@example.test",
					password: "",
					from: "notify2@example.test",
				},
			},
		});

		expect(patchResponse.statusCode).toBe(200);
		expect(patchResponse.body).not.toContain("smtp-secret");
		expect(patchResponse.json()).toMatchObject({
			logging: {
				level: "info",
				retentionDays: 7,
			},
			mail: {
				enabled: true,
				smtp: {
					host: "smtp2.example.test",
					port: 465,
					secure: true,
					username: "notify2@example.test",
					from: "notify2@example.test",
					passwordConfigured: true,
				},
			},
		});

		const getResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/system-settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(getResponse.statusCode).toBe(200);
		expect(getResponse.json().mail.smtp.passwordConfigured).toBe(true);
		expect(getResponse.json().mail.smtp.host).toBe("smtp2.example.test");
	});

	it("rejects unknown system settings sections", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/system-settings/sections/logging",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				level: "debug",
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "VALIDATION_FAILED",
			},
		});
	});

	it("updates external avatar settings", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				avatar: {
					external: {
						enabled: true,
						baseUrl: "https://cravatar.cn/avatar/",
						hashAlgorithm: "md5",
						query: "s=160&d=identicon&f=y",
					},
					display: {
						shape: "rounded",
						sizePx: 48,
					},
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json()).toMatchObject({
			avatar: {
				external: {
					enabled: true,
					baseUrl: "https://cravatar.cn/avatar",
					hashAlgorithm: "md5",
					query: "s=160&d=identicon&f=y",
				},
				display: {
					shape: "rounded",
					sizePx: 48,
				},
			},
		});

		const getResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/system-settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(getResponse.statusCode).toBe(200);
		expect(getResponse.json()).toMatchObject({
			logging: {
				level: "info",
				retentionDays: 7,
			},
			avatar: {
				external: {
					enabled: true,
					baseUrl: "https://cravatar.cn/avatar",
					hashAlgorithm: "md5",
					query: "s=160&d=identicon&f=y",
				},
				display: {
					shape: "rounded",
					sizePx: 48,
				},
			},
		});
	});

	it("rejects invalid external avatar settings", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const invalidHash = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				avatar: {
					external: {
						enabled: true,
						baseUrl: "https://gravatar.com/avatar",
						hashAlgorithm: "sha1",
						query: "s=80",
					},
					display: {
						shape: "circle",
						sizePx: 40,
					},
				},
			},
		});

		expect(invalidHash.statusCode).toBe(400);

		const invalidQuery = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				avatar: {
					external: {
						enabled: true,
						baseUrl: "https://gravatar.com/avatar",
						hashAlgorithm: "sha256",
						query: "?s=80",
					},
					display: {
						shape: "circle",
						sizePx: 40,
					},
				},
			},
		});

		expect(invalidQuery.statusCode).toBe(400);
	});

	it("updates global Akismet settings without returning the API key", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				antiSpam: {
					akismet: {
						apiKey: "akismet-secret",
					},
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.body).not.toContain("akismet-secret");
		expect(updateResponse.json()).toMatchObject({
			antiSpam: {
				akismet: {
					apiKeyConfigured: true,
				},
			},
		});

		const afterUpdate = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "debug",
					retentionDays: 14,
				},
			},
		});

		expect(afterUpdate.statusCode).toBe(200);
		expect(afterUpdate.body).not.toContain("akismet-secret");
		expect(afterUpdate.json().antiSpam.akismet.apiKeyConfigured).toBe(true);
	});

	it("preserves notification channel config secrets when GET response is saved back", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				notifications: {
					channelConfigs: [
						{
							id: "webhook:ops",
							type: "webhook",
							name: "运维 Webhook",
							description: null,
							enabled: true,
							config: {
								url: "https://hooks.example.test/qingyan",
							},
							secretConfig: {
								secret: "webhook-secret",
							},
						},
					],
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.body).not.toContain("webhook-secret");
		const getResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/system-settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(getResponse.statusCode).toBe(200);
		expect(getResponse.body).not.toContain("webhook-secret");
		const channelConfigs = getResponse.json().notifications.channelConfigs;

		const saveBackResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				notifications: {
					channelConfigs,
				},
			},
		});

		expect(saveBackResponse.statusCode).toBe(200);
		expect(saveBackResponse.body).not.toContain("webhook-secret");
		const [row] = await fixture.app.db
			.select()
			.from(notificationChannelConfigs)
			.where(eq(notificationChannelConfigs.id, "webhook:ops"));
		expect(row?.secretConfigJson).toBe(
			JSON.stringify({ secret: "webhook-secret" }),
		);
	});

	it("rejects incomplete webhook and wxpusher channel configs", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				notifications: {
					channelConfigs: [
						{
							id: "webhook:empty",
							type: "webhook",
							name: " ",
							description: null,
							enabled: true,
							config: {
								url: "",
							},
							secretConfig: {},
						},
						{
							id: "wxpusher:bad",
							type: "wxpusher",
							name: "WxPusher",
							description: null,
							enabled: true,
							config: {
								apiUrl: "ftp://wxpusher.example.test/send",
							},
							secretConfig: {},
						},
					],
				},
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "VALIDATION_FAILED",
				fields: expect.arrayContaining([
					expect.objectContaining({
						path: "notifications.channelConfigs.0.name",
					}),
					expect.objectContaining({
						path: "notifications.channelConfigs.0.config.url",
					}),
					expect.objectContaining({
						path: "notifications.channelConfigs.1.config.apiUrl",
					}),
				]),
			},
		});
	});

	it("rejects deleting channel configs referenced by site notification recipients", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const createChannelResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				notifications: {
					channelConfigs: [
						{
							id: "webhook:ops",
							type: "webhook",
							name: "运维 Webhook",
							description: null,
							enabled: true,
							config: {
								url: "https://hooks.example.test/qingyan",
							},
							secretConfig: {
								secret: "webhook-secret",
							},
						},
					],
				},
			},
		});
		expect(createChannelResponse.statusCode).toBe(200);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		const [adminUser] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));
		if (!site || !adminUser) {
			throw new Error("Expected default site and admin user");
		}
		await fixture.app.db.insert(siteNotificationRecipients).values({
			id: "recipient_ops",
			siteId: site.id,
			userId: adminUser.id,
			channelsJson: "[]",
			eventsJson: "[]",
			includeCommentContent: "summary",
			enabled: true,
		});
		await fixture.app.db.insert(siteNotificationRecipientRoutes).values({
			id: "recipient_ops_route",
			recipientId: "recipient_ops",
			eventType: "admin_comment_pending",
			channelConfigId: "webhook:ops",
			enabled: true,
		});

		const deleteReferencedResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				notifications: {
					channelConfigs: [],
				},
			},
		});

		expect(deleteReferencedResponse.statusCode).toBe(400);
		expect(deleteReferencedResponse.json()).toMatchObject({
			error: {
				code: "NOTIFICATION_CHANNEL_CONFIG_IN_USE",
				details: {
					channelConfigIds: ["webhook:ops"],
				},
			},
		});
		const [row] = await fixture.app.db
			.select()
			.from(notificationChannelConfigs)
			.where(eq(notificationChannelConfigs.id, "webhook:ops"));
		expect(row).toBeTruthy();
	});

	it("updates admin session ttl setting", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				admin: {
					session: {
						ttlMinutes: 10080,
					},
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json()).toMatchObject({
			admin: {
				session: {
					ttlMinutes: 10080,
				},
			},
		});

		const getResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/system-settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(getResponse.statusCode).toBe(200);
		expect(getResponse.json()).toMatchObject({
			admin: {
				session: {
					ttlMinutes: 10080,
				},
			},
		});
	});

	it("updates admin email verification settings", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				admin: {
					session: {
						ttlMinutes: 4320,
					},
					emailVerification: {
						selfServiceRequired: false,
					},
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json()).toMatchObject({
			admin: {
				emailVerification: {
					selfServiceRequired: false,
				},
			},
		});

		const getResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/system-settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(getResponse.statusCode).toBe(200);
		expect(getResponse.json()).toMatchObject({
			admin: {
				emailVerification: {
					selfServiceRequired: false,
				},
			},
		});
	});

	it("updates admin deletion retention settings and allows immediate delete mode", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				admin: {
					session: {
						ttlMinutes: 4320,
					},
					emailVerification: {
						selfServiceRequired: true,
					},
					deletion: {
						retentionDays: 0,
					},
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json()).toMatchObject({
			admin: {
				deletion: {
					retentionDays: 0,
				},
			},
		});

		const invalidResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				admin: {
					deletion: {
						retentionDays: -1,
					},
				},
			},
		});

		expect(invalidResponse.statusCode).toBe(400);
		expect(invalidResponse.json()).toMatchObject({
			error: {
				code: "VALIDATION_FAILED",
			},
		});
	});

	it("rejects invalid logging values", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const invalidResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				logging: {
					level: "verbose",
					retentionDays: 0,
				},
			},
		});

		expect(invalidResponse.statusCode).toBe(400);
		expect(invalidResponse.json()).toMatchObject({
			error: {
				code: "VALIDATION_FAILED",
			},
		});
	});
});
