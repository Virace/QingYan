import { z } from "zod";

export const pageLikeBodySchema = z.object({
	siteKey: z.string().min(1),
	pageKey: z.string().min(1),
	pageTitle: z.string().min(1),
	pageUrl: z.string().url(),
});
