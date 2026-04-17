import { z } from "zod";
import { pageUrlInputSchema } from "../shared/page-url";

export const pageLikeBodySchema = z.object({
	siteKey: z.string().min(1),
	pageKey: z.string().min(1),
	pageTitle: z.string().min(1),
	pageUrl: pageUrlInputSchema,
});
