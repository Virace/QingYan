import { z } from "zod";

const rateLimitRuleSchema = z.object({
	windowSec: z.number().int().positive(),
	maxRequests: z.number().int().positive().optional(),
	maxFailures: z.number().int().positive().optional(),
	autoBlacklistSec: z.number().int().positive().optional(),
});

const commentsCaptchaDefaultsSchema = z.object({
	mode: z.enum(["never", "always", "threshold"]),
	thresholdWindowSec: z.number().int().positive(),
	thresholdMaxActions: z.number().int().positive(),
});

const commentIdentityFieldSchema = z.enum(["nickname", "email", "website"]);
const logLevelSchema = z.enum(["error", "warn", "info", "debug"]);
const captchaProviderSchema = z.enum([
	"image",
	"turnstile",
	"hcaptcha",
	"recaptcha",
	"geetest",
]);

const publicOriginGuardSchema = z.object({
	enabled: z.boolean().default(true),
	allowMissingOrigin: z.boolean().default(false),
});

const commentsIdentitySchema = z.object({
	require: z.array(commentIdentityFieldSchema),
});

const commentsAutoBlacklistDefaultsSchema = z.object({
	enabled: z.boolean(),
	scope: z.enum(["post", "all"]),
	ttlSec: z.number().int().positive(),
});

const commentsAbuseGuardDefaultsSchema = z.object({
	enabled: z.boolean(),
	windowSec: z.number().int().positive(),
	maxWriteActions: z.number().int().positive(),
	autoBlacklist: commentsAutoBlacklistDefaultsSchema,
});

const commentsDefaultsSchema = z.object({
	enabled: z.boolean(),
	defaultStatus: z.enum(["pending", "approved"]),
	maxDepth: z.number().int().positive(),
	rootLimit: z.number().int().positive(),
	identity: commentsIdentitySchema,
	captcha: commentsCaptchaDefaultsSchema,
	abuseGuard: commentsAbuseGuardDefaultsSchema,
	allowWebsite: z.boolean().default(true),
});

const siteSchema = z.object({
	siteKey: z.string().min(1),
	name: z.string().min(1),
	allowedOrigins: z
		.array(z.string().url().or(z.string().startsWith("http://localhost:")))
		.min(1),
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

export const configSchema = z.object({
	server: z.object({
		host: z.string().min(1),
		port: z.number().int().positive(),
		publicBaseUrl: z.string().url(),
		trustProxy: z.boolean(),
	}),
	database: z.object({
		client: z.literal("sqlite"),
		sqlite: z.object({
			file: z.string().min(1),
		}),
	}),
	admin: z.object({
		tokenHash: z.string().min(1),
		session: z.object({
			cookieName: z.string().min(1),
			ttlMinutes: z.number().int().positive(),
			sameSite: z.enum(["strict", "lax", "none"]),
			secure: z.boolean(),
		}),
	}),
	security: z.object({
		requestIdHeader: z.string().min(1),
		globalFloodGuard: z.object({
			enabled: z.boolean(),
			windowSec: z.number().int().positive(),
			maxRequests: z.number().int().positive(),
		}),
		publicOriginGuard: publicOriginGuardSchema.default({
			enabled: true,
			allowMissingOrigin: false,
		}),
		rateLimit: z.object({
			adminLogin: rateLimitRuleSchema,
			commentCreate: rateLimitRuleSchema,
			commentVote: rateLimitRuleSchema,
			captchaVerify: rateLimitRuleSchema,
			pageLike: rateLimitRuleSchema.optional(),
		}),
	}),
	captcha: z
		.object({
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
					expectedAction: z.string().min(1).default("COMMENT_SUBMIT"),
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
					expectedAction: z.string().min(1).default("COMMENT_SUBMIT"),
					expectedHostname: z.string().min(1).optional(),
					minScore: z.number().min(0).max(1).default(0.5),
				})
				.optional(),
			geetest: z
				.object({
					captchaId: z.string().min(1),
					captchaKey: z.string().min(1),
					apiServer: z.string().url().default("https://gcaptcha4.geetest.com"),
				})
				.optional(),
		})
		.superRefine((captcha, ctx) => {
			if (captcha.provider === "turnstile" && !captcha.turnstile) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "captcha.turnstile is required when provider is turnstile",
					path: ["turnstile"],
				});
			}
			if (captcha.provider === "hcaptcha" && !captcha.hcaptcha) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "captcha.hcaptcha is required when provider is hcaptcha",
					path: ["hcaptcha"],
				});
			}
			if (captcha.provider === "recaptcha" && !captcha.recaptcha) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "captcha.recaptcha is required when provider is recaptcha",
					path: ["recaptcha"],
				});
			}
			if (captcha.provider === "geetest" && !captcha.geetest) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "captcha.geetest is required when provider is geetest",
					path: ["geetest"],
				});
			}
		}),
	logging: z.object({
		directory: z.string().min(1),
		defaults: z.object({
			level: logLevelSchema,
			retentionDays: z.number().int().positive().max(3650),
		}),
	}),
	mail: z.object({
		enabled: z.boolean(),
		smtp: z.object({
			host: z.string().min(1),
			port: z.number().int().positive(),
			secure: z.boolean(),
			username: z.string().min(1),
			password: z.string().min(1),
			from: z.string().email(),
		}),
	}),
	sites: z.array(siteSchema).min(1),
});

export type AppConfig = z.infer<typeof configSchema>;
export type SiteConfig = z.infer<typeof siteSchema>;
