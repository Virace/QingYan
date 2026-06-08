import { z } from "zod";

export const devSessionBodySchema = z.object({
	token: z.string().min(1),
});

export const devStateQuerySchema = z.object({
	siteKey: z.literal("default"),
	pageKey: z.string().min(1),
	visitorKey: z.string().min(1).optional(),
});

export const devResetBodySchema = z.object({
	siteKey: z.literal("default"),
	pageKey: z.string().min(1),
});

export const devScenarioBodySchema = z.object({
	siteKey: z.literal("default"),
	pageKey: z.string().min(1),
	scenario: z.enum([
		"comments-captcha-always",
		"comments-threshold-next-write",
		"comments-seeded-thread",
	]),
	pageTitle: z.string().min(1).optional(),
	pageUrl: z.string().url().optional(),
});
