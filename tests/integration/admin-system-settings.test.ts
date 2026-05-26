import { afterEach, describe, expect, it } from "vitest";

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
				gravatar: {
					enabled: false,
					baseUrl: "https://gravatar.com/avatar",
				},
			},
			antiSpam: {
				akismet: {
					apiKeyConfigured: false,
				},
			},
			admin: {
				session: {
					ttlMinutes: 4320,
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

	it("updates global Gravatar settings", async () => {
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
					gravatar: {
						enabled: true,
						baseUrl: "https://cravatar.cn/avatar/",
					},
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json()).toMatchObject({
			avatar: {
				gravatar: {
					enabled: true,
					baseUrl: "https://cravatar.cn/avatar",
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
				gravatar: {
					enabled: true,
					baseUrl: "https://cravatar.cn/avatar",
				},
			},
		});
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
				code: "INVALID_REQUEST",
			},
		});
	});
});
