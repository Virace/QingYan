import { z } from "zod";
import { pageUrlInputSchema } from "../shared/page-url";

export const inlineCaptchaPayloadSchema = z.object({
	challengeId: z.string().min(1),
	value: z.string().min(1),
});

export const bootstrapQuerySchema = z.object({
	siteKey: z.string().min(1),
	pageKey: z.string().min(1).optional(),
	pageTitle: z.string().min(1).optional(),
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
	siteKey: z.string().min(1),
	pageKey: z.string().min(1).optional(),
	pageTitle: z.string().min(1),
	pageUrl: pageUrlInputSchema.optional(),
	parentCommentId: z.string().min(1).nullable(),
	author: z.object({
		name: z.string().trim().optional().default(""),
		email: z.string().trim().email().optional(),
		website: z.string().trim().optional(),
	}),
	content: z.object({
		raw: z.string().min(1),
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
	commentId: z.string().min(1),
});

export const voteCommentBodySchema = z.object({
	siteKey: z.string().min(1),
	pageKey: z.string().min(1).optional(),
	choice: z.enum(["up", "down"]),
	captcha: inlineCaptchaPayloadSchema.optional().nullable(),
});

export const captchaStateQuerySchema = z.object({
	siteKey: z.string().min(1),
	pageKey: z.string().min(1).optional(),
	pageTitle: z.string().min(1).optional(),
	pageUrl: pageUrlInputSchema.optional(),
});

export const captchaRefreshBodySchema = captchaStateQuerySchema;

export const captchaVerifyBodySchema = z.object({
	siteKey: z.string().min(1),
	pageKey: z.string().min(1).optional(),
	challengeId: z.string().min(1),
	mode: z.literal("inline_value"),
	value: z.string().min(1),
});

export const captchaWidgetQuerySchema = z.object({
	siteKey: z.string().min(1),
	pageKey: z.string().min(1),
	challengeId: z.string().min(1),
});

export const captchaCompleteBodySchema = z.object({
	siteKey: z.string().min(1),
	pageKey: z.string().min(1),
	challengeId: z.string().min(1),
	token: z.string().min(1).optional(),
	lotNumber: z.string().min(1).optional(),
	captchaOutput: z.string().min(1).optional(),
	passToken: z.string().min(1).optional(),
	genTime: z.string().min(1).optional(),
});
