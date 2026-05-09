export type CommentAuthorIdentity = "visitor" | "verified";

export interface VerifiedAuthorSettings {
	enabled: boolean;
	displayName: string;
	email: string;
	website: string;
	badgeLabel: string;
}

export interface PublicVerifiedAuthorViewer {
	displayName: string;
	badgeLabel: string;
}

export const defaultVerifiedAuthor: VerifiedAuthorSettings = {
	enabled: true,
	displayName: "管理员",
	email: "",
	website: "",
	badgeLabel: "管理员",
};

export function normalizeVerifiedAuthorEmail(email?: string | null): string {
	return email?.trim().toLowerCase() ?? "";
}

function readString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value.trim() : fallback;
}

export function mergeVerifiedAuthorSettings(
	raw?: string | null,
): VerifiedAuthorSettings {
	if (!raw) {
		return defaultVerifiedAuthor;
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return defaultVerifiedAuthor;
	}

	return {
		enabled:
			typeof parsed.enabled === "boolean"
				? parsed.enabled
				: defaultVerifiedAuthor.enabled,
		displayName:
			readString(parsed.displayName, defaultVerifiedAuthor.displayName) ||
			defaultVerifiedAuthor.displayName,
		email: normalizeVerifiedAuthorEmail(readString(parsed.email, "")),
		website: readString(parsed.website, defaultVerifiedAuthor.website),
		badgeLabel:
			readString(parsed.badgeLabel, defaultVerifiedAuthor.badgeLabel) ||
			defaultVerifiedAuthor.badgeLabel,
	};
}

export function serializeVerifiedAuthorSettings(
	settings: VerifiedAuthorSettings,
): string {
	return JSON.stringify({
		enabled: settings.enabled,
		displayName:
			settings.displayName.trim() || defaultVerifiedAuthor.displayName,
		email: normalizeVerifiedAuthorEmail(settings.email),
		website: settings.website.trim(),
		badgeLabel: settings.badgeLabel.trim() || defaultVerifiedAuthor.badgeLabel,
	});
}

export function isReservedVerifiedAuthorEmail(
	inputEmail: string | undefined,
	settings: VerifiedAuthorSettings,
): boolean {
	const reservedEmail = normalizeVerifiedAuthorEmail(settings.email);
	if (!reservedEmail || !inputEmail) {
		return false;
	}

	return normalizeVerifiedAuthorEmail(inputEmail) === reservedEmail;
}

export function toPublicVerifiedAuthorViewer(
	settings: VerifiedAuthorSettings,
): PublicVerifiedAuthorViewer | undefined {
	if (!settings.enabled) {
		return undefined;
	}

	return {
		displayName: settings.displayName,
		badgeLabel: settings.badgeLabel,
	};
}
