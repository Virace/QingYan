import { z } from "zod";

import { validateAdminConsolePath } from "./admin-console-path";

const rateLimitRuleSchema = z.object({
	windowSec: z.number().int().positive(),
	maxRequests: z.number().int().positive().optional(),
	maxFailures: z.number().int().positive().optional(),
	autoBlacklistSec: z.number().int().positive().optional(),
});

const publicOriginGuardSchema = z.object({
	enabled: z.boolean().default(true),
	allowMissingOrigin: z.boolean().default(false),
});

const adminConsoleSchema = z
	.object({
		path: z
			.string()
			.min(1)
			.refine((value) => validateAdminConsolePath(value) === null, {
				message: "admin.console.path must be a safe non-reserved path",
			})
			.optional(),
	})
	.default({});

const adminAuthSchema = z
	.object({
		username: z.string().min(1).optional(),
		passwordHash: z.string().min(1).optional(),
	})
	.default({});

const startupAdminSchema = z
	.object({
		session: z
			.object({
				cookieName: z.string().min(1),
				ttlMinutes: z.number().int().positive(),
				sameSite: z.enum(["strict", "lax", "none"]),
				secure: z.boolean(),
			})
			.strict(),
	})
	.strict();

export const configSchema = z
	.object({
		server: z
			.object({
				host: z.string().min(1),
				port: z.number().int().positive(),
				publicBaseUrl: z.string().url(),
				trustProxy: z.boolean(),
			})
			.strict(),
		database: z
			.object({
				client: z.literal("sqlite"),
				sqlite: z
					.object({
						file: z.string().min(1),
					})
					.strict(),
			})
			.strict(),
		admin: startupAdminSchema,
		security: z
			.object({
				requestIdHeader: z.string().min(1),
				globalFloodGuard: z
					.object({
						enabled: z.boolean(),
						windowSec: z.number().int().positive(),
						maxRequests: z.number().int().positive(),
					})
					.strict(),
				publicOriginGuard: publicOriginGuardSchema.default({
					enabled: true,
					allowMissingOrigin: false,
				}),
				rateLimit: z
					.object({
						adminLogin: rateLimitRuleSchema,
						commentCreate: rateLimitRuleSchema,
						commentVote: rateLimitRuleSchema,
						captchaVerify: rateLimitRuleSchema,
						pageLike: rateLimitRuleSchema.optional(),
					})
					.strict(),
			})
			.strict(),
	})
	.strict();

const commentIdentityFieldSchema = z.enum(["nickname", "email", "website"]);
const logLevelSchema = z.enum(["error", "warn", "info", "debug"]);
const captchaProviderSchema = z.enum([
	"image",
	"turnstile",
	"hcaptcha",
	"recaptcha",
	"geetest",
]);

const commentsCaptchaDefaultsSchema = z.object({
	mode: z.enum(["never", "always", "threshold"]),
	thresholdWindowSec: z.number().int().positive(),
	thresholdMaxActions: z.number().int().positive(),
});

const commentsMetadataSchema = z.object({
	collectIp: z.boolean(),
	collectUserAgent: z.boolean(),
	ipRegion: z.object({
		enabled: z.boolean(),
		cachePolicy: z.enum(["file", "vectorIndex", "content"]),
		precision: z.enum(["country", "province", "city"]),
		autoUpdate: z.object({
			enabled: z.boolean(),
			schedule: z.literal("monthly"),
		}),
		ipv4: z.object({
			dbPath: z.string().min(1),
			sources: z.array(z.string().url()),
		}),
		ipv6: z.object({
			dbPath: z.string().min(1),
			sources: z.array(z.string().url()),
		}),
	}),
	device: z.object({
		enabled: z.boolean(),
		display: z.object({
			enabled: z.boolean(),
		}),
	}),
});

const commentsDefaultsSchema = z.object({
	enabled: z.boolean(),
	defaultStatus: z.enum(["pending", "approved"]),
	maxDepth: z.number().int().positive(),
	rootLimit: z.number().int().positive(),
	identity: z.object({
		require: z.array(commentIdentityFieldSchema),
	}),
	captcha: commentsCaptchaDefaultsSchema,
	abuseGuard: z.object({
		enabled: z.boolean(),
		windowSec: z.number().int().positive(),
		maxWriteActions: z.number().int().positive(),
		autoBlacklist: z.object({
			enabled: z.boolean(),
			scope: z.enum(["post", "all"]),
			ttlSec: z.number().int().positive(),
		}),
	}),
	metadata: commentsMetadataSchema,
	allowWebsite: z.boolean(),
});

const siteSchema = z.object({
	siteKey: z.string().min(1),
	name: z.string().min(1),
	allowedOrigins: z.array(z.string().url()).min(1),
	defaults: z.object({
		comments: commentsDefaultsSchema,
		pageFeedback: z.object({
			allowLike: z.boolean(),
		}),
		notifications: z.object({
			emailEnabled: z.boolean(),
		}),
	}),
});

const captchaConfigSchema = z.object({
	provider: captchaProviderSchema,
	image: z.object({
		width: z.number().int().positive(),
		height: z.number().int().positive(),
		ttlSec: z.number().int().positive(),
	}),
	turnstile: z
		.object({
			siteKey: z.string().min(1),
			secretKey: z.string().min(1),
			expectedAction: z.string().min(1),
			expectedHostname: z.string().min(1).optional(),
		})
		.optional(),
	hcaptcha: z
		.object({
			siteKey: z.string().min(1),
			secretKey: z.string().min(1),
			expectedHostname: z.string().min(1).optional(),
		})
		.optional(),
	recaptcha: z
		.object({
			variant: z.enum(["score_based", "policy_based_challenge"]),
			projectId: z.string().min(1),
			siteKey: z.string().min(1),
			apiKey: z.string().min(1),
			expectedAction: z.string().min(1),
			expectedHostname: z.string().min(1).optional(),
			minScore: z.number().min(0).max(1),
		})
		.optional(),
	geetest: z
		.object({
			captchaId: z.string().min(1),
			captchaKey: z.string().min(1),
			apiServer: z.string().url(),
		})
		.optional(),
});

const loggingConfigSchema = z.object({
	directory: z.string().min(1),
	defaults: z.object({
		level: logLevelSchema,
		retentionDays: z.number().int().positive().max(3650),
	}),
});

const mailConfigSchema = z.object({
	enabled: z.boolean(),
	smtp: z.object({
		host: z.string().min(1),
		port: z.number().int().positive(),
		secure: z.boolean(),
		username: z.string().min(1),
		password: z.string().min(1),
		from: z.string().email(),
	}),
});

export type StartupConfig = z.infer<typeof configSchema>;
export type SiteConfig = z.infer<typeof siteSchema>;
export type CaptchaConfig = z.infer<typeof captchaConfigSchema>;
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;
export type MailConfig = z.infer<typeof mailConfigSchema>;

export interface TransitionalRuntimeConfig {
	admin: StartupConfig["admin"] & {
		console: z.infer<typeof adminConsoleSchema>;
		auth: z.infer<typeof adminAuthSchema>;
		tokenHash?: string;
	};
	captcha: CaptchaConfig;
	logging: LoggingConfig;
	mail: MailConfig;
	sites: SiteConfig[];
}

export type AppConfig = Omit<StartupConfig, "admin"> &
	Pick<
		TransitionalRuntimeConfig,
		"admin" | "captcha" | "logging" | "mail" | "sites"
	>;

const defaultSite: SiteConfig = {
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
			metadata: {
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
};

const transitionalRuntimeDefaults: Omit<TransitionalRuntimeConfig, "admin"> = {
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
	sites: [defaultSite],
};

export function withTransitionalRuntimeDefaults(
	config: StartupConfig,
): AppConfig {
	return {
		...structuredClone(config),
		admin: {
			...structuredClone(config.admin),
			console: {
				path: "/admin",
			},
			auth: {},
		},
		...structuredClone(transitionalRuntimeDefaults),
	};
}
