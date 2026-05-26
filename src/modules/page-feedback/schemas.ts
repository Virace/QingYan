import { z } from "zod";
import { pageUrlInputSchema } from "../shared/page-url";
import { inlineCaptchaPayloadSchema } from "../comments/schemas";

export const pageLikeBodySchema = z.object({
	siteKey: z.string().min(1),
	pageKey: z.string().min(1).optional(),
	pageTitle: z.string().min(1),
	pageUrl: pageUrlInputSchema.optional(),
	captcha: inlineCaptchaPayloadSchema.optional().nullable(),
});
