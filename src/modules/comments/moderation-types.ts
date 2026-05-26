import { z } from "zod";

export const commentStatusSchema = z.enum([
	"pending",
	"approved",
	"spam",
	"trash",
]);

export type CommentStatus = z.infer<typeof commentStatusSchema>;

export const moderationModeSchema = z.enum([
	"none",
	"akismet_auto",
	"manual_with_akismet",
	"manual",
]);

export type ModerationMode = z.infer<typeof moderationModeSchema>;

export const moderationProviderSchema = z.enum(["none", "akismet", "combined"]);
export type ModerationProvider = z.infer<typeof moderationProviderSchema>;

export const moderationDecisionSchema = z.enum(["approve", "pending", "spam"]);
export type ModerationDecision = z.infer<typeof moderationDecisionSchema>;

export const moderationFailPolicySchema = z.literal("pending");
export type ModerationFailPolicy = z.infer<typeof moderationFailPolicySchema>;

export const siteModerationSettingsSchema = z.object({
	mode: moderationModeSchema,
	provider: z.enum(["none", "akismet"]),
	akismet: z.object({
		blogUrl: z.string().url().optional(),
		failPolicy: moderationFailPolicySchema,
		discardBlatantSpam: z.boolean(),
	}),
});

export type SiteModerationSettings = z.infer<
	typeof siteModerationSettingsSchema
>;

export const defaultSiteModerationSettings: SiteModerationSettings = {
	mode: "manual",
	provider: "none",
	akismet: {
		failPolicy: "pending",
		discardBlatantSpam: false,
	},
};

export function mapDefaultStatusToModerationMode(
	status: "pending" | "approved",
): ModerationMode {
	return status === "approved" ? "none" : "manual";
}

export function isVisibleCommentStatus(status: CommentStatus): boolean {
	return status === "approved";
}

export function resolvePublicCommentStatus(
	status: CommentStatus,
): "pending" | "approved" {
	return status === "approved" ? "approved" : "pending";
}

export function mergeSiteModerationSettings(
	payload?: string | null,
	fallbackDefaultStatus?: "pending" | "approved",
): SiteModerationSettings {
	if (!payload) {
		return {
			...defaultSiteModerationSettings,
			mode: fallbackDefaultStatus
				? mapDefaultStatusToModerationMode(fallbackDefaultStatus)
				: defaultSiteModerationSettings.mode,
		};
	}

	try {
		const parsed = JSON.parse(payload) as Partial<SiteModerationSettings>;
		return siteModerationSettingsSchema.parse({
			...defaultSiteModerationSettings,
			...parsed,
			akismet: {
				...defaultSiteModerationSettings.akismet,
				...parsed.akismet,
			},
		});
	} catch {
		return {
			...defaultSiteModerationSettings,
			mode: fallbackDefaultStatus
				? mapDefaultStatusToModerationMode(fallbackDefaultStatus)
				: defaultSiteModerationSettings.mode,
		};
	}
}

export function serializeSiteModerationSettings(
	settings: SiteModerationSettings,
): string {
	return JSON.stringify(siteModerationSettingsSchema.parse(settings));
}
