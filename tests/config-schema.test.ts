import { describe, expect, it } from "vitest";

import { configSchema } from "../src/config/types";

describe("configSchema", () => {
	it("accepts the documented qingyan example shape", () => {
		const parsed = configSchema.parse({
			server: {
				host: "0.0.0.0",
				port: 4401,
				publicBaseUrl: "http://localhost:4401",
				trustProxy: false,
			},
			database: {
				client: "sqlite",
				sqlite: {
					file: "./data/qingyan.db",
				},
			},
			admin: {
				console: {
					path: "/admin",
				},
				auth: {
					username: "admin",
					passwordHash: "scrypt:salt:hash",
				},
				session: {
					cookieName: "qingyan_admin",
					ttlMinutes: 1440,
					sameSite: "lax",
					secure: false,
				},
			},
			security: {
				requestIdHeader: "x-request-id",
				globalFloodGuard: {
					enabled: false,
					windowSec: 10,
					maxRequests: 120,
				},
				publicOriginGuard: {
					enabled: true,
					allowMissingOrigin: false,
				},
				rateLimit: {
					adminLogin: {
						windowSec: 600,
						maxFailures: 5,
					},
					commentCreate: {
						windowSec: 300,
						maxRequests: 5,
					},
					commentVote: {
						windowSec: 300,
						maxRequests: 15,
					},
					captchaVerify: {
						windowSec: 300,
						maxFailures: 8,
					},
					pageLike: {
						windowSec: 300,
						maxRequests: 10,
					},
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
			logging: {
				directory: "./logs",
				defaults: {
					level: "info",
					retentionDays: 7,
				},
			},
			mail: {
				enabled: false,
				smtp: {
					host: "smtp.example.com",
					port: 465,
					secure: true,
					username: "notify@example.com",
					password: "secret",
					from: "notify@example.com",
				},
			},
			sites: [
				{
					siteKey: "fangyuan",
					name: "FangYuan",
					allowedOrigins: ["http://localhost:4321"],
					defaults: {
						comments: {
							enabled: true,
							defaultStatus: "pending",
							maxDepth: 3,
							rootLimit: 20,
							identity: {
								require: ["nickname", "email"],
							},
							captcha: {
								mode: "threshold",
								thresholdWindowSec: 60,
								thresholdMaxActions: 3,
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
							allowWebsite: true,
						},
						pageFeedback: {
							allowLike: true,
						},
						notifications: {
							emailEnabled: false,
						},
					},
				},
			],
		});

		expect(parsed.sites[0]?.siteKey).toBe("fangyuan");
		expect(parsed.security.globalFloodGuard).toEqual({
			enabled: false,
			windowSec: 10,
			maxRequests: 120,
		});
		expect(parsed.security.publicOriginGuard).toEqual({
			enabled: true,
			allowMissingOrigin: false,
		});
		expect(parsed.logging).toEqual({
			directory: "./logs",
			defaults: {
				level: "info",
				retentionDays: 7,
			},
		});
		expect(parsed.sites[0]?.defaults.comments.identity).toEqual({
			require: ["nickname", "email"],
		});
		expect(parsed.sites[0]?.defaults.comments.captcha).toEqual({
			mode: "threshold",
			thresholdWindowSec: 60,
			thresholdMaxActions: 3,
		});
		expect(parsed.sites[0]?.defaults.comments.abuseGuard).toEqual({
			enabled: true,
			windowSec: 600,
			maxWriteActions: 100,
			autoBlacklist: {
				enabled: true,
				scope: "post",
				ttlSec: 1800,
			},
		});
		expect(parsed.sites[0]?.defaults.comments.metadata).toEqual({
			collectIp: true,
			collectUserAgent: true,
			ipRegion: {
				enabled: false,
				cachePolicy: "vectorIndex",
				precision: "province",
				autoUpdate: {
					enabled: false,
					schedule: "monthly",
				},
				ipv4: {
					dbPath: "./data/ip2region_v4.xdb",
					sources: [
						"https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb",
						"https://gitee.com/lionsoul/ip2region/raw/master/data/ip2region_v4.xdb",
					],
				},
				ipv6: {
					dbPath: "./data/ip2region_v6.xdb",
					sources: [
						"https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v6.xdb",
						"https://gitee.com/lionsoul/ip2region/raw/master/data/ip2region_v6.xdb",
					],
				},
			},
			device: {
				enabled: true,
				display: {
					enabled: false,
				},
			},
		});
	});

	it("rejects reserved admin console paths", () => {
		const parsed = configSchema.safeParse({
			server: {
				host: "0.0.0.0",
				port: 4401,
				publicBaseUrl: "http://localhost:4401",
				trustProxy: false,
			},
			database: {
				client: "sqlite",
				sqlite: {
					file: "./data/qingyan.db",
				},
			},
			admin: {
				console: {
					path: "/api/admin",
				},
				auth: {
					username: "admin",
					passwordHash: "scrypt:salt:hash",
				},
				session: {
					cookieName: "qingyan_admin",
					ttlMinutes: 1440,
					sameSite: "lax",
					secure: false,
				},
			},
			security: {
				requestIdHeader: "x-request-id",
				globalFloodGuard: {
					enabled: false,
					windowSec: 10,
					maxRequests: 120,
				},
				publicOriginGuard: {
					enabled: true,
					allowMissingOrigin: false,
				},
				rateLimit: {
					adminLogin: {
						windowSec: 600,
						maxFailures: 5,
					},
					commentCreate: {
						windowSec: 300,
						maxRequests: 5,
					},
					commentVote: {
						windowSec: 300,
						maxRequests: 15,
					},
					captchaVerify: {
						windowSec: 300,
						maxFailures: 8,
					},
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
			logging: {
				directory: "./logs",
				defaults: {
					level: "info",
					retentionDays: 7,
				},
			},
			mail: {
				enabled: false,
				smtp: {
					host: "smtp.example.com",
					port: 465,
					secure: true,
					username: "notify@example.com",
					password: "secret",
					from: "notify@example.com",
				},
			},
			sites: [
				{
					siteKey: "fangyuan",
					name: "FangYuan",
					allowedOrigins: ["http://localhost:4321"],
					defaults: {
						comments: {
							enabled: true,
							defaultStatus: "pending",
							maxDepth: 3,
							rootLimit: 20,
							identity: {
								require: ["nickname", "email"],
							},
							captcha: {
								mode: "threshold",
								thresholdWindowSec: 60,
								thresholdMaxActions: 3,
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
							allowWebsite: true,
						},
						pageFeedback: {
							allowLike: true,
						},
						notifications: {
							emailEnabled: false,
						},
					},
				},
			],
		});

		expect(parsed.success).toBe(false);
	});

	it("accepts a turnstile captcha configuration while preserving shared image settings", () => {
		const parsed = configSchema.parse({
			server: {
				host: "0.0.0.0",
				port: 4401,
				publicBaseUrl: "http://localhost:4401",
				trustProxy: false,
			},
			database: {
				client: "sqlite",
				sqlite: {
					file: "./data/qingyan.db",
				},
			},
			admin: {
				console: {
					path: "/admin",
				},
				auth: {
					username: "admin",
					passwordHash: "scrypt:salt:hash",
				},
				session: {
					cookieName: "qingyan_admin",
					ttlMinutes: 1440,
					sameSite: "lax",
					secure: false,
				},
			},
			security: {
				requestIdHeader: "x-request-id",
				globalFloodGuard: {
					enabled: false,
					windowSec: 10,
					maxRequests: 120,
				},
				publicOriginGuard: {
					enabled: true,
					allowMissingOrigin: false,
				},
				rateLimit: {
					adminLogin: {
						windowSec: 600,
						maxFailures: 5,
					},
					commentCreate: {
						windowSec: 300,
						maxRequests: 5,
					},
					commentVote: {
						windowSec: 300,
						maxRequests: 15,
					},
					captchaVerify: {
						windowSec: 300,
						maxFailures: 8,
					},
					pageLike: {
						windowSec: 300,
						maxRequests: 10,
					},
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
					siteKey: "1x00000000000000000000AA",
					secretKey: "turnstile-secret",
					expectedAction: "COMMENT_SUBMIT",
					expectedHostname: "comments.example.com",
				},
			},
			logging: {
				directory: "./logs",
				defaults: {
					level: "info",
					retentionDays: 7,
				},
			},
			mail: {
				enabled: false,
				smtp: {
					host: "smtp.example.com",
					port: 465,
					secure: true,
					username: "notify@example.com",
					password: "secret",
					from: "notify@example.com",
				},
			},
			sites: [
				{
					siteKey: "fangyuan",
					name: "FangYuan",
					allowedOrigins: ["http://localhost:4321"],
					defaults: {
						comments: {
							enabled: true,
							defaultStatus: "pending",
							maxDepth: 3,
							rootLimit: 20,
							identity: {
								require: ["nickname", "email"],
							},
							captcha: {
								mode: "threshold",
								thresholdWindowSec: 60,
								thresholdMaxActions: 3,
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
							allowWebsite: true,
						},
						pageFeedback: {
							allowLike: true,
						},
						notifications: {
							emailEnabled: false,
						},
					},
				},
			],
		});

		expect(parsed.captcha.provider).toBe("turnstile");
		expect(parsed.captcha.turnstile).toMatchObject({
			siteKey: "1x00000000000000000000AA",
			expectedHostname: "comments.example.com",
		});
		expect(parsed.captcha.image.ttlSec).toBe(600);
	});

	it("accepts a Google Cloud recaptcha configuration", () => {
		const parsed = configSchema.parse({
			server: {
				host: "0.0.0.0",
				port: 4401,
				publicBaseUrl: "http://localhost:4401",
				trustProxy: false,
			},
			database: {
				client: "sqlite",
				sqlite: {
					file: "./data/qingyan.db",
				},
			},
			admin: {
				console: {
					path: "/admin",
				},
				auth: {
					username: "admin",
					passwordHash: "scrypt:salt:hash",
				},
				session: {
					cookieName: "qingyan_admin",
					ttlMinutes: 1440,
					sameSite: "lax",
					secure: false,
				},
			},
			security: {
				requestIdHeader: "x-request-id",
				globalFloodGuard: {
					enabled: false,
					windowSec: 10,
					maxRequests: 120,
				},
				publicOriginGuard: {
					enabled: true,
					allowMissingOrigin: false,
				},
				rateLimit: {
					adminLogin: {
						windowSec: 600,
						maxFailures: 5,
					},
					commentCreate: {
						windowSec: 300,
						maxRequests: 5,
					},
					commentVote: {
						windowSec: 300,
						maxRequests: 15,
					},
					captchaVerify: {
						windowSec: 300,
						maxFailures: 8,
					},
					pageLike: {
						windowSec: 300,
						maxRequests: 10,
					},
				},
			},
			captcha: {
				provider: "recaptcha",
				image: {
					width: 160,
					height: 60,
					ttlSec: 600,
				},
				recaptcha: {
					variant: "policy_based_challenge",
					projectId: "qingyan-test-project",
					siteKey: "6L-example",
					apiKey: "AIza-example",
					expectedAction: "COMMENT_SUBMIT",
					expectedHostname: "comments.example.com",
					minScore: 0.6,
				},
			},
			logging: {
				directory: "./logs",
				defaults: {
					level: "info",
					retentionDays: 7,
				},
			},
			mail: {
				enabled: false,
				smtp: {
					host: "smtp.example.com",
					port: 465,
					secure: true,
					username: "notify@example.com",
					password: "secret",
					from: "notify@example.com",
				},
			},
			sites: [
				{
					siteKey: "fangyuan",
					name: "FangYuan",
					allowedOrigins: ["http://localhost:4321"],
					defaults: {
						comments: {
							enabled: true,
							defaultStatus: "pending",
							maxDepth: 3,
							rootLimit: 20,
							identity: {
								require: ["nickname", "email"],
							},
							captcha: {
								mode: "threshold",
								thresholdWindowSec: 60,
								thresholdMaxActions: 3,
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
							allowWebsite: true,
						},
						pageFeedback: {
							allowLike: true,
						},
						notifications: {
							emailEnabled: false,
						},
					},
				},
			],
		});

		expect(parsed.captcha.provider).toBe("recaptcha");
		expect(parsed.captcha.recaptcha).toMatchObject({
			variant: "policy_based_challenge",
			projectId: "qingyan-test-project",
			minScore: 0.6,
		});
	});
});
