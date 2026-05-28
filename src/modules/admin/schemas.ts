import { z } from "zod";

import {
	commentStatusSchema,
	siteModerationSettingsSchema,
} from "../comments/moderation-types";
import { isSafeHttpUrl, normalizeOrigin } from "../shared/url-policy";
import {
	avatarSettingsSchema,
	securitySettingsSchema,
} from "../system-settings/definitions";

const commentIdentityFieldSchema = z.enum(["nickname", "email", "website"]);
const commentMetadataSchema = z.object({
	collectIp: z.boolean().optional(),
	collectUserAgent: z.boolean().optional(),
	ipRegion: z
		.object({
			enabled: z.boolean().optional(),
			precision: z.enum(["country", "province", "city"]).optional(),
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
const verifiedAuthorSchema = z
	.object({
		enabled: z.boolean(),
		displayName: z.string().trim().min(1),
		email: z.string().trim().email().or(z.literal("")),
		website: z
			.string()
			.trim()
			.refine((value) => value === "" || isSafeHttpUrl(value), {
				message: "website 仅允许 http 或 https。",
			}),
		badgeLabel: z.string().trim().min(1),
	})
	.superRefine((value, context) => {
		if (value.enabled && !value.email.trim()) {
			context.addIssue({
				code: "custom",
				path: ["email"],
				message: "启用可信评论作者时必须填写邮箱。",
			});
		}
	});
const staffDisplaySchema = z.object({
	nameMode: z.enum(["current_profile", "snapshot"]),
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
	status: commentStatusSchema.optional(),
	statusGroup: z.enum(["hidden"]).optional(),
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

const siteOriginSchema = z.string().refine((value) => {
	try {
		normalizeOrigin(value);
		return true;
	} catch {
		return false;
	}
}, "allowedOrigins 必须是纯 origin");

const singleSiteOriginListSchema = z
	.array(siteOriginSchema)
	.length(1, "每个站点只能配置一个前端 Origin。");

export const adminPagesQuerySchema = adminCollectionQuerySchema;
export const adminUsersQuerySchema = adminCollectionQuerySchema;
export const adminVisitorsQuerySchema = adminCollectionQuerySchema;

export const adminSiteCreateBodySchema = z.object({
	siteKey: z
		.string()
		.min(1)
		.regex(/^[a-z0-9][a-z0-9_-]*$/i),
	name: z.string().min(1),
	allowedOrigins: singleSiteOriginListSchema,
});

export const adminSiteParamsSchema = z.object({
	siteKey: z.string().min(1),
});

export const adminSitePatchBodySchema = z
	.object({
		name: z.string().min(1).optional(),
		allowedOrigins: singleSiteOriginListSchema.optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "至少需要一个更新字段",
	});

export const adminCommentParamsSchema = z.object({
	commentId: z.string().min(1),
});

export const adminCommentPatchBodySchema = z
	.object({
		status: commentStatusSchema.optional(),
		isPinned: z.boolean().optional(),
		isFolded: z.boolean().optional(),
		contentRaw: z.string().min(1).optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "至少需要一个更新字段",
	});

export const adminCommentReplyBodySchema = z.object({
	content: z.object({
		raw: z.string().min(1),
	}),
});

export const adminCommentBulkTrashBodySchema = z.object({
	commentIds: z.array(z.string().min(1)).min(1).max(100),
});

export const adminCommentBulkUpdateBodySchema = z.object({
	commentIds: z.array(z.string().min(1)).min(1).max(100),
	patch: adminCommentPatchBodySchema,
});

export const adminCommentBulkMetadataRefreshBodySchema = z.object({
	commentIds: z.array(z.string().min(1)).min(1).max(100),
});

export const adminCommentClearTrashBodySchema = z.object({
	siteKey: z.string().min(1).optional(),
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
				verifiedAuthor: verifiedAuthorSchema.optional(),
				staffDisplay: staffDisplaySchema.optional(),
				moderation: siteModerationSettingsSchema.optional(),
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
	admin: z
		.object({
			session: z.object({
				ttlMinutes: z.number().int().positive(),
			}),
		})
		.optional(),
	security: securitySettingsSchema.optional(),
	logging: z.object({
		level: z.enum(["error", "warn", "info", "debug"]),
		retentionDays: z.number().int().min(1).max(3650),
	}),
	mail: z
		.object({
			enabled: z.boolean(),
			smtp: z.object({
				host: z.string(),
				port: z.number().int().positive(),
				secure: z.boolean(),
				username: z.string(),
				password: z.string().min(1).optional(),
				from: z.string(),
			}),
		})
		.optional(),
	captcha: z
		.object({
			provider: z.enum([
				"image",
				"turnstile",
				"hcaptcha",
				"recaptcha",
				"geetest",
			]),
			image: z.object({
				width: z.number().int().positive(),
				height: z.number().int().positive(),
				ttlSec: z.number().int().positive(),
			}),
			turnstile: z
				.object({
					siteKey: z.string(),
					secretKey: z.string().min(1).optional(),
					expectedAction: z.string(),
					expectedHostname: z.string().optional(),
				})
				.optional(),
			hcaptcha: z
				.object({
					siteKey: z.string(),
					secretKey: z.string().min(1).optional(),
					expectedHostname: z.string().optional(),
				})
				.optional(),
			recaptcha: z
				.object({
					variant: z.enum(["score_based", "policy_based_challenge"]),
					projectId: z.string(),
					siteKey: z.string(),
					apiKey: z.string().min(1).optional(),
					expectedAction: z.string(),
					expectedHostname: z.string().optional(),
					minScore: z.number().min(0).max(1),
				})
				.optional(),
			geetest: z
				.object({
					captchaId: z.string(),
					captchaKey: z.string().min(1).optional(),
					apiServer: z.string().url(),
				})
				.optional(),
		})
		.optional(),
	ipRegion: z
		.object({
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
		})
		.optional(),
	avatar: avatarSettingsSchema.optional(),
	publicApi: z
		.object({
			advisoryFields: z.object({
				enabled: z.boolean(),
			}),
		})
		.optional(),
	antiSpam: z
		.object({
			akismet: z.object({
				apiKey: z.string().min(1).optional(),
			}),
		})
		.optional(),
});
