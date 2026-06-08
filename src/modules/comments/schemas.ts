import { z } from "zod";
import { pageUrlInputSchema } from "../shared/page-url";
import { commentInputLimitHardCaps } from "../shared/site-settings-defaults";

const siteKeyInputSchema = z.string().min(1).max(128);
const pageKeyInputSchema = z
	.string()
	.min(1)
	.max(commentInputLimitHardCaps.pageKeyMaxLength);
const pageTitleInputSchema = z
	.string()
	.min(1)
	.max(commentInputLimitHardCaps.pageTitleMaxLength);
const commentIdInputSchema = z.string().min(1).max(256);

export const inlineCaptchaPayloadSchema = z.object({
	challengeId: z.string().min(1).max(256),
	value: z.string().min(1).max(1024),
});

export const bootstrapQuerySchema = z.object({
	siteKey: siteKeyInputSchema,
	pageKey: pageKeyInputSchema.optional(),
	pageTitle: pageTitleInputSchema.optional(),
	pageUrl: pageUrlInputSchema.optional(),
	sortBy: z.enum(["newest", "oldest"]).default("newest"),
	limit: z.coerce.number().int().positive().max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0),
});

export const threadQuerySchema = bootstrapQuerySchema.pick({
	siteKey: true,
	pageKey: true,
	sortBy: true,
	limit: true,
	offset: true,
});

export const createCommentBodySchema = z.object({
	siteKey: siteKeyInputSchema,
	pageKey: pageKeyInputSchema.optional(),
	pageTitle: pageTitleInputSchema,
	pageUrl: pageUrlInputSchema.optional(),
	parentCommentId: commentIdInputSchema.nullable(),
	author: z.object({
		name: z
			.string()
			.trim()
			.max(commentInputLimitHardCaps.authorNameMaxLength)
			.optional()
			.default(""),
		email: z.string().trim().max(254).email().optional(),
		website: z
			.string()
			.trim()
			.max(commentInputLimitHardCaps.authorWebsiteMaxLength)
			.optional(),
	}),
	content: z.object({
		raw: z.string().min(1).max(commentInputLimitHardCaps.contentMaxLength),
	}),
	options: z
		.object({
			notifyOnReply: z.boolean().default(false),
		})
		.optional()
		.default({ notifyOnReply: false }),
	captcha: inlineCaptchaPayloadSchema.optional().nullable(),
});

export const voteCommentParamsSchema = z.object({
	commentId: commentIdInputSchema,
});

export const voteCommentBodySchema = z.object({
	siteKey: siteKeyInputSchema,
	pageKey: pageKeyInputSchema.optional(),
	choice: z.enum(["up", "down"]),
	captcha: inlineCaptchaPayloadSchema.optional().nullable(),
});

export const captchaStateQuerySchema = z.object({
	siteKey: siteKeyInputSchema,
	pageKey: pageKeyInputSchema.optional(),
	pageTitle: pageTitleInputSchema.optional(),
	pageUrl: pageUrlInputSchema.optional(),
});

export const captchaRefreshBodySchema = captchaStateQuerySchema;

export const captchaVerifyBodySchema = z.object({
	siteKey: siteKeyInputSchema,
	pageKey: pageKeyInputSchema.optional(),
	challengeId: z.string().min(1).max(256),
	mode: z.literal("inline_value"),
	value: z.string().min(1).max(1024),
});

export const captchaWidgetQuerySchema = z.object({
	siteKey: siteKeyInputSchema,
	pageKey: pageKeyInputSchema,
	challengeId: z.string().min(1).max(256),
});

export const captchaCompleteBodySchema = z.object({
	siteKey: siteKeyInputSchema,
	pageKey: pageKeyInputSchema,
	challengeId: z.string().min(1).max(256),
	token: z.string().min(1).max(8192).optional(),
	lotNumber: z.string().min(1).max(256).optional(),
	captchaOutput: z.string().min(1).max(8192).optional(),
	passToken: z.string().min(1).max(8192).optional(),
	genTime: z.string().min(1).max(128).optional(),
});
