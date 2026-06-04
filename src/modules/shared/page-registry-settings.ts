export type PageRegistryMode = "discovery" | "authoritative";
export type UnknownPageResponse = "inactive_payload" | "forbidden";

export interface PageRegistrySettings {
	mode: PageRegistryMode;
	authoritativeSourceIds: number[];
	unknownPageResponse: UnknownPageResponse;
	requireHealthySource: boolean;
	sourceFreshnessGraceSec: number;
	emergencyLockdown: boolean;
}

export type PageRegistrySettingsPatch = Partial<PageRegistrySettings>;

export const defaultPageRegistrySettings: PageRegistrySettings = {
	mode: "discovery",
	authoritativeSourceIds: [],
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

function normalizeSourceIds(value: unknown): number[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const seen = new Set<number>();
	const ids: number[] = [];
	for (const item of value) {
		if (!Number.isInteger(item) || item <= 0 || seen.has(item)) {
			continue;
		}
		seen.add(item);
		ids.push(item);
	}
	return ids;
}

function normalizeSettings(input: unknown): PageRegistrySettings {
	const record = isRecord(input) ? input : {};
	const mode = normalizeMode(record.mode) ?? defaultPageRegistrySettings.mode;
	const settings: PageRegistrySettings = {
		mode,
		authoritativeSourceIds:
			normalizeSourceIds(record.authoritativeSourceIds) ??
			defaultPageRegistrySettings.authoritativeSourceIds,
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
