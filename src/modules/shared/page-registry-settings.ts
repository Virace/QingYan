export type PageRegistryMode = "discovery" | "authoritative";
export type UnknownPageResponse = "inactive_payload" | "forbidden";

export interface PageRegistrySettings {
	mode: PageRegistryMode;
	authoritativeSitemapUrls: string[];
	unknownPageResponse: UnknownPageResponse;
	requireHealthySource: boolean;
	sourceFreshnessGraceSec: number;
	emergencyLockdown: boolean;
}

export type PageRegistrySettingsPatch = Partial<PageRegistrySettings>;

export const defaultPageRegistrySettings: PageRegistrySettings = {
	mode: "discovery",
	authoritativeSitemapUrls: [],
	unknownPageResponse: "inactive_payload",
	requireHealthySource: true,
	sourceFreshnessGraceSec: 7200,
	emergencyLockdown: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeMode(value: unknown): PageRegistryMode | undefined {
	return value === "discovery" || value === "authoritative" ? value : undefined;
}

function normalizeUnknownPageResponse(
	value: unknown,
): UnknownPageResponse | undefined {
	return value === "inactive_payload" || value === "forbidden"
		? value
		: undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
	if (!Number.isInteger(value) || (value as number) < 0) {
		return undefined;
	}
	return value as number;
}

function normalizeSitemapUrls(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") {
			continue;
		}
		try {
			const parsed = new URL(item.trim());
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				continue;
			}
			const normalized = parsed.toString();
			if (seen.has(normalized)) {
				continue;
			}
			seen.add(normalized);
			urls.push(normalized);
		} catch {}
	}
	return urls;
}

function normalizeSettings(input: unknown): PageRegistrySettings {
	const record = isRecord(input) ? input : {};
	const mode = normalizeMode(record.mode) ?? defaultPageRegistrySettings.mode;
	const settings: PageRegistrySettings = {
		mode,
		authoritativeSitemapUrls:
			normalizeSitemapUrls(record.authoritativeSitemapUrls) ??
			defaultPageRegistrySettings.authoritativeSitemapUrls,
		unknownPageResponse:
			normalizeUnknownPageResponse(record.unknownPageResponse) ??
			defaultPageRegistrySettings.unknownPageResponse,
		requireHealthySource:
			normalizeBoolean(record.requireHealthySource) ??
			defaultPageRegistrySettings.requireHealthySource,
		sourceFreshnessGraceSec:
			normalizeNonNegativeInteger(record.sourceFreshnessGraceSec) ??
			defaultPageRegistrySettings.sourceFreshnessGraceSec,
		emergencyLockdown:
			normalizeBoolean(record.emergencyLockdown) ??
			defaultPageRegistrySettings.emergencyLockdown,
	};
	if (settings.mode === "authoritative") {
		settings.requireHealthySource = true;
	}
	return settings;
}

export function mergePageRegistrySettings(
	payload?: string | null,
): PageRegistrySettings {
	if (!payload) {
		return { ...defaultPageRegistrySettings };
	}
	try {
		return normalizeSettings(JSON.parse(payload) as unknown);
	} catch {
		return { ...defaultPageRegistrySettings };
	}
}

export function mergePageRegistrySettingsPatch(
	current: PageRegistrySettings,
	patch: PageRegistrySettingsPatch,
): PageRegistrySettings {
	return normalizeSettings({
		...current,
		...patch,
	});
}

export function serializePageRegistrySettings(
	settings: PageRegistrySettings,
): string {
	return JSON.stringify(normalizeSettings(settings));
}
