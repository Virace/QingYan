import { z } from "zod";

const commentIdentityFieldSchema = z.enum(["nickname", "email", "website"]);
const commentMetadataSchema = z.object({
	collectIp: z.boolean().optional(),
	collectUserAgent: z.boolean().optional(),
	ipRegion: z
		.object({
			enabled: z.boolean().optional(),
			cachePolicy: z.enum(["file", "vectorIndex", "content"]).optional(),
			precision: z.enum(["country", "province", "city"]).optional(),
			autoUpdate: z
				.object({
					enabled: z.boolean().optional(),
					schedule: z.literal("monthly").optional(),
				})
				.optional(),
			ipv4: z
				.object({
					dbPath: z.string().min(1).optional(),
					sources: z.array(z.string().url()).optional(),
				})
				.optional(),
			ipv6: z
				.object({
					dbPath: z.string().min(1).optional(),
					sources: z.array(z.string().url()).optional(),
				})
				.optional(),
		})
		.optional(),
	device: z
		.object({
			enabled: z.boolean().optional(),
			display: z
				.object({
					enabled: z.boolean().optional(),
				})
				.optional(),
		})
		.optional(),
});

export const adminLoginBodySchema = z.object({
	username: z.string().min(1),
	password: z.string().min(1),
	challengeId: z.string().min(1).optional(),
	captchaValue: z.string().min(1).optional(),
});

export const adminCommentsQuerySchema = z.object({
	siteKey: z.string().min(1).optional(),
	pageKey: z.string().min(1).optional(),
	status: z.enum(["pending", "approved"]).optional(),
	search: z.string().min(1).optional(),
	limit: z.coerce.number().int().positive().max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0),
});

const adminCollectionQuerySchema = z.object({
	siteKey: z.string().min(1).optional(),
	search: z.string().min(1).optional(),
	limit: z.coerce.number().int().positive().max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0),
});

export const adminPagesQuerySchema = adminCollectionQuerySchema;
export const adminUsersQuerySchema = adminCollectionQuerySchema;
export const adminVisitorsQuerySchema = adminCollectionQuerySchema;

export const adminSiteCreateBodySchema = z.object({
	siteKey: z
		.string()
		.min(1)
		.regex(/^[a-z0-9][a-z0-9_-]*$/i),
	name: z.string().min(1),
	allowedOrigins: z.array(z.string().url()).min(1),
});

export const adminCommentParamsSchema = z.object({
	commentId: z.string().min(1),
});

export const adminCommentPatchBodySchema = z
	.object({
		status: z.enum(["pending", "approved"]).optional(),
		isPinned: z.boolean().optional(),
		isFolded: z.boolean().optional(),
		contentRaw: z.string().min(1).optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "至少需要一个更新字段",
	});

export const adminBlacklistQuerySchema = z.object({
	siteKey: z.string().min(1).optional(),
});

export const adminBlacklistBodySchema = z.object({
	siteKey: z.string().min(1).optional(),
	targetType: z.enum(["ip", "email", "visitor"]),
	matchMode: z.enum(["exact", "cidr", "wildcard"]).default("exact"),
	targetValue: z.string().min(1),
	scope: z.enum(["post", "all"]).default("post"),
	reason: z.string().min(1).optional(),
	expiresAt: z.string().datetime().optional(),
});

export const adminBlacklistParamsSchema = z.object({
	ruleId: z.coerce.number().int().positive(),
});

export const adminBlacklistTargetBodySchema = z.object({
	siteKey: z.string().min(1).optional(),
	targetType: z.enum(["ip", "email", "visitor"]),
	matchMode: z.enum(["exact", "cidr", "wildcard"]).default("exact"),
	targetValue: z.string().min(1),
});

export const adminSettingsQuerySchema = z.object({
	siteKey: z.string().min(1),
});

export const adminSettingsBodySchema = z
	.object({
		comments: z
			.object({
				enabled: z.boolean().optional(),
				defaultStatus: z.enum(["pending", "approved"]).optional(),
				maxDepth: z.number().int().positive().optional(),
				rootLimit: z.number().int().positive().optional(),
				identity: z
					.object({
						require: z.array(commentIdentityFieldSchema).optional(),
					})
					.optional(),
				allowWebsite: z.boolean().optional(),
				captcha: z
					.object({
						mode: z.enum(["never", "always", "threshold"]).optional(),
						thresholdWindowSec: z.number().int().positive().optional(),
						thresholdMaxActions: z.number().int().positive().optional(),
					})
					.optional(),
				abuseGuard: z
					.object({
						enabled: z.boolean().optional(),
						windowSec: z.number().int().positive().optional(),
						maxWriteActions: z.number().int().positive().optional(),
						autoBlacklist: z
							.object({
								enabled: z.boolean().optional(),
								scope: z.enum(["post", "all"]).optional(),
								ttlSec: z.number().int().positive().optional(),
							})
							.optional(),
					})
					.optional(),
				metadata: commentMetadataSchema.optional(),
			})
			.optional(),
		pageFeedback: z
			.object({
				allowLike: z.boolean().optional(),
			})
			.optional(),
		notifications: z
			.object({
				emailEnabled: z.boolean().optional(),
			})
			.optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "至少需要一个更新字段",
	});

export const adminSystemSettingsBodySchema = z.object({
	logging: z.object({
		level: z.enum(["error", "warn", "info", "debug"]),
		retentionDays: z.number().int().min(1).max(3650),
	}),
});
