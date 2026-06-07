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
const engagementSettingsSchema = z.object({
	visitors: z
		.object({
			enabled: z.boolean().optional(),
		})
		.optional(),
	pageViews: z
		.object({
			enabled: z.boolean().optional(),
		})
		.optional(),
	pageLikes: z
		.object({
			enabled: z.boolean().optional(),
		})
		.optional(),
	commentVotes: z
		.object({
			enabled: z.boolean().optional(),
		})
		.optional(),
});

const adminNotificationDeliverySettingsSchema = z.object({
	globalMaxPerMinute: z.number().int().positive().optional(),
	perChannelMaxPerMinute: z.number().int().positive().optional(),
	perSiteMaxPerHour: z.number().int().positive().optional(),
	perRecipientMinIntervalSec: z.number().int().min(0).optional(),
	dailyChannelBudget: z.number().int().positive().optional(),
	lowPriorityDelaySec: z.number().int().min(0).optional(),
	queueBackend: z.enum(["database", "bullmq"]).optional(),
});

const adminSystemNotificationsSchema = z.object({
	delivery: adminNotificationDeliverySettingsSchema.optional(),
	channelConfigs: z
		.array(
			z
				.object({
					id: z.string().trim().min(1).optional(),
					type: z.enum(["email", "webhook", "wxpusher"]),
					name: z.string().trim().min(1),
					description: z.string().trim().nullable().optional(),
					enabled: z.boolean().default(true),
					config: z.record(z.string(), z.unknown()).default({}),
					secretConfig: z.record(z.string(), z.unknown()).optional(),
				})
				.superRefine((value, context) => {
					if (value.type === "webhook") {
						const url =
							typeof value.config.url === "string"
								? value.config.url.trim()
								: "";
						if (!url || !isSafeHttpUrl(url)) {
							context.addIssue({
								code: "custom",
								path: ["config", "url"],
								message: "Webhook URL 必须是合法的 http/https URL。",
							});
						}
					}
					if (value.type === "wxpusher") {
						const apiUrl =
							typeof value.config.apiUrl === "string"
								? value.config.apiUrl.trim()
								: "";
						if (apiUrl && !isSafeHttpUrl(apiUrl)) {
							context.addIssue({
								code: "custom",
								path: ["config", "apiUrl"],
								message: "WxPusher API URL 必须是合法的 http/https URL。",
							});
						}
					}
				}),
		)
		.optional(),
	webhook: z
		.object({
			enabled: z.boolean().optional(),
			url: z.string().url().or(z.literal("")).optional(),
			secret: z.string().optional(),
		})
		.optional(),
	wxpusher: z
		.object({
			enabled: z.boolean().optional(),
			appToken: z.string().optional(),
			apiUrl: z.string().url().optional(),
		})
		.optional(),
});

const notificationTemplateFormatSchema = z.enum(["html", "text", "json"]);

export const adminNotificationTemplateBodySchema = z.object({
	format: notificationTemplateFormatSchema,
	subjectTemplate: z.string().optional().nullable(),
	bodyTemplate: z.string().min(1),
});

export const adminNotificationTemplatePreviewBodySchema = z
	.object({
		format: notificationTemplateFormatSchema.optional(),
		subjectTemplate: z.string().optional().nullable(),
		bodyTemplate: z.string().optional(),
	})
	.optional()
	.default({});

export const adminNotificationTemplateTestBodySchema = z.object({
	recipient: z.string().min(1).optional(),
});

const siteNotificationRecipientChannelSchema = z.enum([
	"email",
	"webhook",
	"wxpusher",
]);
const siteNotificationRecipientEventSchema = z.enum([
	"admin_comment_pending",
	"admin_comment_approved",
]);
const siteNotificationRecipientRouteSchema = z.object({
	eventType: siteNotificationRecipientEventSchema,
	channelConfigId: z.string().trim().min(1),
	enabled: z.boolean().default(true),
});
const siteNotificationRecipientSchema = z
	.object({
		userId: z.number().int().positive(),
		channels: z.array(siteNotificationRecipientChannelSchema).min(1).optional(),
		events: z.array(siteNotificationRecipientEventSchema).min(1).optional(),
		routes: z.array(siteNotificationRecipientRouteSchema).min(1).optional(),
		includeCommentContent: z
			.enum(["none", "summary", "full"])
			.default("summary"),
		rateLimitProfile: z.string().trim().min(1).nullable().optional(),
		enabled: z.boolean().default(true),
	})
	.refine((value) => value.routes || (value.channels && value.events), {
		message: "通知接收人必须配置至少一个事件和接收渠道。",
	});

const sectionPatchBodySchema = z
	.record(z.string(), z.unknown())
	.refine((value) => Object.keys(value).length > 0, {
		message: "至少需要一个更新字段",
	});

export const adminSystemSettingsSectionParamsSchema = z.object({
	section: z.enum([
		"security",
		"rate-limit",
		"mail",
		"notifications",
		"captcha",
		"avatar",
		"ip-region",
		"anti-spam",
	]),
});

export const adminSiteSettingsSectionParamsSchema = z.object({
	siteKey: z.string().min(1),
	section: z.enum(["comments", "engagement", "notifications", "pageRegistry"]),
});

export const adminSectionPatchBodySchema = sectionPatchBodySchema;

export const adminLoginBodySchema = z.object({
	username: z.string().min(1),
	password: z.string().min(1),
	challengeId: z.string().min(1).optional(),
	captchaValue: z.string().min(1).optional(),
});

export const adminUserGroupKeySchema = z.enum([
	"admin",
	"site_admin",
	"site_moderator",
]);

export const adminUsersQuerySchema = z.object({
	siteKey: z.string().min(1).optional(),
	search: z.string().min(1).optional(),
	limit: z.coerce.number().int().positive().max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

export const adminUserParamsSchema = z.object({
	userId: z.coerce.number().int().positive(),
});

export const adminUserCreateBodySchema = z.object({
	username: z.string().trim().min(1),
	email: z.string().trim().email(),
	displayName: z.string().trim().min(1),
	password: z.string().min(8),
	groupKey: adminUserGroupKeySchema,
	siteKeys: z.array(z.string().min(1)).default([]),
	passwordChangeRequired: z.boolean().default(false),
});

export const adminUserPatchBodySchema = z
	.object({
		email: z.string().trim().email().optional(),
		displayName: z.string().trim().min(1).optional(),
		groupKey: adminUserGroupKeySchema.optional(),
		siteKeys: z.array(z.string().min(1)).optional(),
		status: z.enum(["active", "disabled", "deleted"]).optional(),
		passwordChangeRequired: z.boolean().optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "至少需要一个更新字段",
	});

export const adminUserResetPasswordBodySchema = z.object({
	password: z.string().min(8),
	passwordChangeRequired: z.boolean().default(true),
});

export const adminUserRevokeSessionsBodySchema = z
	.object({
		loginBlockPreset: z
			.enum(["none", "1h", "1d", "7d", "custom"])
			.default("none"),
		loginBlockedUntil: z.string().datetime().optional(),
		reason: z.string().trim().max(500).optional(),
	})
	.superRefine((value, context) => {
		if (value.loginBlockPreset === "custom" && !value.loginBlockedUntil) {
			context.addIssue({
				code: "custom",
				path: ["loginBlockedUntil"],
				message: "自定义禁止登录时间不能为空。",
			});
		}
	});

export const adminProfilePatchBodySchema = z
	.object({
		displayName: z.string().trim().min(1).optional(),
		website: z.string().trim().url().or(z.literal("")).optional(),
		avatarUrl: z.string().trim().url().or(z.literal("")).optional(),
	})
	.passthrough()
	.refine((value) => Object.keys(value).length > 0, {
		message: "至少需要一个更新字段",
	});

export const adminProfilePasswordBodySchema = z
	.object({
		currentPassword: z.string().min(1),
		nextPassword: z.string().min(8),
		confirmPassword: z.string().min(8),
	})
	.refine((value) => value.nextPassword === value.confirmPassword, {
		path: ["confirmPassword"],
		message: "两次输入的新密码不一致。",
	});

export const adminProfileEmailChangeBodySchema = z.object({
	newEmail: z
		.string()
		.trim()
		.email()
		.transform((value) => value.toLowerCase()),
	currentPassword: z.string().min(1),
});

export const adminProfileEmailChangeConfirmBodySchema = z.object({
	token: z.string().min(1),
});

export const adminProfilePasswordConfirmBodySchema = z.object({
	token: z.string().min(1),
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
export const adminCommentersQuerySchema = adminCollectionQuerySchema;
export const adminVisitorsQuerySchema = adminCollectionQuerySchema.extend({
	ip: z.string().trim().min(1).optional(),
	userAgent: z.string().trim().min(1).optional(),
	pageUrl: z.string().trim().min(1).optional(),
	device: z.string().trim().min(1).optional(),
	location: z.string().trim().min(1).optional(),
	blacklist: z.enum(["any", "ip", "visitor", "none"]).optional(),
});

export const pageRegistryStatusSchema = z.enum([
	"active",
	"stale",
	"unreachable",
	"not_found",
	"trash",
	"deleted",
	"ignored",
]);

export const adminPageSortBySchema = z.enum([
	"updatedAt",
	"createdAt",
	"commentCount",
	"visitorCount",
	"commenterCount",
	"pageLikeCount",
	"title",
	"pageKey",
]);

export const adminPageSortOrderSchema = z.enum(["asc", "desc"]);

export const pendingPageStatusSchema = z.enum([
	"pending",
	"approved",
	"rejected",
	"ignored",
]);

export const adminPagesWithStatusQuerySchema =
	adminCollectionQuerySchema.extend({
		status: pageRegistryStatusSchema.optional(),
		sortBy: adminPageSortBySchema.default("updatedAt"),
		sortOrder: adminPageSortOrderSchema.default("desc"),
	});

export const adminPendingPageApproveBodySchema = z.object({
	siteKey: z.string().min(1),
	pageKey: z.string().min(1),
});

export const adminPendingPagesQuerySchema = adminCollectionQuerySchema.extend({
	status: pendingPageStatusSchema.optional(),
});

export const adminPendingPageDecisionBodySchema =
	adminPendingPageApproveBodySchema.extend({
		reason: z.string().max(500).optional(),
	});

export const adminPageKeyParamsSchema = z.object({
	pageKey: z.string().min(1),
});

export const adminPageLifecycleBodySchema = z
	.object({
		siteKey: z.string().min(1).optional(),
	})
	.default({});

export const adminPageTitleRefreshBodySchema = z.object({
	siteKey: z.string().min(1),
	runAfter: z.string().datetime().nullable().optional(),
	maxAttempts: z.number().int().min(1).max(10).optional(),
	retryDelaySec: z.number().int().min(0).max(86_400).optional(),
	timeoutMs: z.number().int().min(1000).max(60_000).optional(),
	maxBytes: z
		.number()
		.int()
		.min(65_536)
		.max(10 * 1024 * 1024)
		.optional(),
});

export const adminMaintenanceTasksQuerySchema = z.object({
	siteKey: z.string().min(1).optional(),
	type: z.string().min(1).optional(),
	status: z.string().min(1).optional(),
	limit: z.coerce.number().int().positive().max(100).default(20),
});

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
	search: z.string().min(1).optional(),
	limit: z.coerce.number().int().positive().max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0),
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
		engagement: engagementSettingsSchema.optional(),
		pageRegistry: z
			.object({
				mode: z.enum(["discovery", "authoritative"]).optional(),
				authoritativeSitemapUrls: z.array(z.string().trim().url()).optional(),
				unknownPageResponse: z
					.enum(["inactive_payload", "forbidden"])
					.optional(),
				requireHealthySource: z.boolean().optional(),
				sourceFreshnessGraceSec: z.number().int().min(0).optional(),
				emergencyLockdown: z.boolean().optional(),
			})
			.optional(),
		notifications: z
			.object({
				commenter: z
					.object({
						replyEmailEnabled: z.boolean().optional(),
					})
					.optional(),
				backend: z
					.object({
						enabled: z.boolean().optional(),
						recipients: z.array(siteNotificationRecipientSchema).optional(),
					})
					.optional(),
			})
			.optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "至少需要一个更新字段",
	});

export const adminSystemSettingsBodySchema = z.object({
	admin: z
		.object({
			session: z
				.object({
					ttlMinutes: z.number().int().positive(),
				})
				.optional(),
			emailVerification: z
				.object({
					selfServiceRequired: z.boolean(),
				})
				.optional(),
			deletion: z
				.object({
					retentionDays: z.number().int().min(0).max(3650),
				})
				.optional(),
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
				password: z.string().optional(),
				from: z.string(),
			}),
		})
		.optional(),
	notifications: adminSystemNotificationsSchema.optional(),
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
					secretKey: z.string().optional(),
					expectedAction: z.string(),
					expectedHostname: z.string().optional(),
				})
				.optional(),
			hcaptcha: z
				.object({
					siteKey: z.string(),
					secretKey: z.string().optional(),
					expectedHostname: z.string().optional(),
				})
				.optional(),
			recaptcha: z
				.object({
					variant: z.enum(["score_based", "policy_based_challenge"]),
					projectId: z.string(),
					siteKey: z.string(),
					apiKey: z.string().optional(),
					expectedAction: z.string(),
					expectedHostname: z.string().optional(),
					minScore: z.number().min(0).max(1),
				})
				.optional(),
			geetest: z
				.object({
					captchaId: z.string(),
					captchaKey: z.string().optional(),
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
				apiKey: z.string().optional(),
			}),
		})
		.optional(),
});

export const adminNotificationChannelTestBodySchema = z
	.object({
		channel: z.enum(["email", "webhook", "wxpusher"]).optional(),
		channelConfigId: z.string().trim().min(1).optional(),
		recipient: z.string().trim().min(1).optional(),
		siteKey: z.string().trim().min(1).optional(),
	})
	.refine((value) => value.channelConfigId || value.channel, {
		message: "必须选择一个通知渠道配置。",
	});

export const adminMailTestBodySchema = z
	.object({
		recipient: z.string().trim().min(1).optional(),
	})
	.optional()
	.default({});
