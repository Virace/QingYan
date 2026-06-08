import { z } from "zod";
import { pageUrlInputSchema } from "../shared/page-url";
import { inlineCaptchaPayloadSchema } from "../comments/schemas";
import { commentInputLimitHardCaps } from "../shared/site-settings-defaults";

export const pageLikeBodySchema = z.object({
	siteKey: z.string().min(1).max(128),
	pageKey: z
		.string()
		.min(1)
		.max(commentInputLimitHardCaps.pageKeyMaxLength)
		.optional(),
	pageTitle: z
		.string()
		.min(1)
		.max(commentInputLimitHardCaps.pageTitleMaxLength),
	pageUrl: pageUrlInputSchema.optional(),
	captcha: inlineCaptchaPayloadSchema.optional().nullable(),
});
