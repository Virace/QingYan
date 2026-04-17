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
	captcha: commentsCaptchaDefaultsSchema,
	abuseGuard: commentsAbuseGuardDefaultsSchema,
	requireEmail: z.boolean().default(false),
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
		rateLimit: z.object({
			adminLogin: rateLimitRuleSchema,
			commentCreate: rateLimitRuleSchema,
			commentVote: rateLimitRuleSchema,
			captchaVerify: rateLimitRuleSchema,
			pageLike: rateLimitRuleSchema.optional(),
		}),
	}),
	captcha: z.object({
		provider: z.literal("image"),
		image: z.object({
			width: z.number().int().positive(),
			height: z.number().int().positive(),
			ttlSec: z.number().int().positive(),
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
