import type { AdminSettings, AdminSystemSettings } from "@/api/admin";

export function countersEnabled(settings: AdminSettings): boolean {
	return (
		settings.engagement.pageViews.enabled ||
		settings.engagement.pageLikes.enabled ||
		settings.engagement.commentVotes.enabled
	);
}

export function showLowTrustCounterHint(settings: AdminSettings): boolean {
	return !settings.engagement.visitors.enabled && countersEnabled(settings);
}

export function showCaptchaThresholdDetails(settings: AdminSettings): boolean {
	return (
		settings.comments.enabled && settings.comments.captcha.mode === "threshold"
	);
}

export function showExternalAvatarDetails(
	settings: AdminSystemSettings,
): boolean {
	return settings.avatar.external.enabled;
}

export function showMailDetails(settings: AdminSystemSettings): boolean {
	return settings.mail.enabled;
}
