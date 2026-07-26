import {
	defaultStaffDisplaySettings,
	defaultVerifiedAuthor,
	serializeStaffDisplaySettings,
	serializeVerifiedAuthorSettings,
} from "../comments/verified-author";
import {
	defaultSiteModerationSettings,
	serializeSiteModerationSettings,
} from "../comments/moderation-types";

export type CommentMetadataSettings = {
	collectIp: boolean;
	collectUserAgent: boolean;
	ipRegion: {
		enabled: boolean;
		precision: "country" | "province" | "city";
	};
	device: {
		enabled: boolean;
		display: {
			enabled: boolean;
		};
	};
};

export type EngagementTrustMode = "trusted" | "lightweight";

export type EngagementSettings = {
	visitors: {
		enabled: boolean;
	};
	pageViews: {
		enabled: boolean;
	};
	pageLikes: {
		enabled: boolean;
	};
	commentVotes: {
		enabled: boolean;
	};
};

export type CommentInputLimitsSettings = {
	authorNameMaxLength: number;
	authorWebsiteMaxLength: number;
	pageTitleMaxLength: number;
	pageKeyMaxLength: number;
	contentMaxLength: number;
};

export const defaultCommentRequire: Array<"nickname" | "email" | "website"> = [
	"nickname",
	"email",
];

export const defaultCommentMetadata: CommentMetadataSettings = {
	collectIp: true,
	collectUserAgent: true,
	ipRegion: {
		enabled: false,
		precision: "province",
	},
	device: {
		enabled: true,
		display: {
			enabled: false,
		},
	},
};

export const defaultEngagementSettings: EngagementSettings = {
	visitors: {
		enabled: true,
	},
	pageViews: {
		enabled: true,
	},
	pageLikes: {
		enabled: true,
	},
	commentVotes: {
		enabled: true,
	},
};

export const commentInputLimitHardCaps: CommentInputLimitsSettings = {
	authorNameMaxLength: 100,
	authorWebsiteMaxLength: 4096,
	pageTitleMaxLength: 500,
	pageKeyMaxLength: 1024,
	contentMaxLength: 10000,
};

export const defaultCommentInputLimits: CommentInputLimitsSettings = {
	authorNameMaxLength: 40,
	authorWebsiteMaxLength: 2048,
	pageTitleMaxLength: 200,
	pageKeyMaxLength: 512,
	contentMaxLength: 2000,
};

type LegacyBoolean = boolean | 0 | 1;

export type EngagementSettingsPatch = {
	visitors?: {
		enabled?: boolean;
	};
	pageViews?: {
		enabled?: boolean;
	};
	pageLikes?: {
		enabled?: boolean;
	};
	commentVotes?: {
		enabled?: boolean;
	};
};

type CommentInputLimitsPatch = Partial<
	Record<keyof CommentInputLimitsSettings, unknown>
>;

function parseSettingsObject<T>(value?: string | T | null): Partial<T> {
	if (typeof value === "string" && value.trim()) {
		try {
			const parsed = JSON.parse(value) as unknown;
			return typeof parsed === "object" && parsed !== null
				? (parsed as Partial<T>)
				: {};
		} catch {
			return {};
		}
	}
	if (typeof value === "object" && value !== null) {
		return value as Partial<T>;
	}
	return {};
}

function resolvePositiveInteger(
	value: unknown,
	fallback: number,
	hardCap: number,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	const normalized = Math.floor(value);
	if (normalized < 1) {
		return fallback;
	}
	return Math.min(normalized, hardCap);
}

type LegacyEngagementSettingsPatch = {
	visitors?: {
		enabled?: LegacyBoolean;
	};
	pageViews?: {
		enabled?: LegacyBoolean;
	};
	pageLikes?: {
		enabled?: LegacyBoolean;
	};
	commentVotes?: {
		enabled?: LegacyBoolean;
	};
};

export function readPersistedBoolean(
	value: unknown,
	fallback: boolean,
): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	if (value === 0) {
		return false;
	}
	if (value === 1) {
		return true;
	}
	return fallback;
}

export function mergeEngagementSettings(
	value?: string | EngagementSettingsPatch | null,
): EngagementSettings {
	let parsed: LegacyEngagementSettingsPatch = {};
	if (typeof value === "string" && value.trim()) {
		try {
			parsed = JSON.parse(value) as LegacyEngagementSettingsPatch;
		} catch {
			parsed = {};
		}
	} else if (typeof value === "object" && value !== null) {
		parsed = value as LegacyEngagementSettingsPatch;
	}

	return {
		visitors: {
			enabled: readPersistedBoolean(
				parsed.visitors?.enabled,
				defaultEngagementSettings.visitors.enabled,
			),
		},
		pageViews: {
			enabled: readPersistedBoolean(
				parsed.pageViews?.enabled,
				defaultEngagementSettings.pageViews.enabled,
			),
		},
		pageLikes: {
			enabled: readPersistedBoolean(
				parsed.pageLikes?.enabled,
				defaultEngagementSettings.pageLikes.enabled,
			),
		},
		commentVotes: {
			enabled: readPersistedBoolean(
				parsed.commentVotes?.enabled,
				defaultEngagementSettings.commentVotes.enabled,
			),
		},
	};
}

export function mergeEngagementSettingsPatch(
	current: EngagementSettings,
	patch?: EngagementSettingsPatch,
): EngagementSettings {
	if (!patch) {
		return current;
	}

	return {
		visitors: {
			enabled: patch.visitors?.enabled ?? current.visitors.enabled,
		},
		pageViews: {
			enabled: patch.pageViews?.enabled ?? current.pageViews.enabled,
		},
		pageLikes: {
			enabled: patch.pageLikes?.enabled ?? current.pageLikes.enabled,
		},
		commentVotes: {
			enabled: patch.commentVotes?.enabled ?? current.commentVotes.enabled,
		},
	};
}

export function serializeEngagementSettings(
	settings: EngagementSettings,
): string {
	return JSON.stringify(mergeEngagementSettings(settings));
}

export function mergeCommentInputLimits(
	value?: string | CommentInputLimitsPatch | null,
): CommentInputLimitsSettings {
	const parsed = parseSettingsObject<CommentInputLimitsPatch>(value);

	return {
		authorNameMaxLength: resolvePositiveInteger(
			parsed.authorNameMaxLength,
			defaultCommentInputLimits.authorNameMaxLength,
			commentInputLimitHardCaps.authorNameMaxLength,
		),
		authorWebsiteMaxLength: resolvePositiveInteger(
			parsed.authorWebsiteMaxLength,
			defaultCommentInputLimits.authorWebsiteMaxLength,
			commentInputLimitHardCaps.authorWebsiteMaxLength,
		),
		pageTitleMaxLength: resolvePositiveInteger(
			parsed.pageTitleMaxLength,
			defaultCommentInputLimits.pageTitleMaxLength,
			commentInputLimitHardCaps.pageTitleMaxLength,
		),
		pageKeyMaxLength: resolvePositiveInteger(
			parsed.pageKeyMaxLength,
			defaultCommentInputLimits.pageKeyMaxLength,
			commentInputLimitHardCaps.pageKeyMaxLength,
		),
		contentMaxLength: resolvePositiveInteger(
			parsed.contentMaxLength,
			defaultCommentInputLimits.contentMaxLength,
			commentInputLimitHardCaps.contentMaxLength,
		),
	};
}

export function serializeCommentInputLimits(
	settings: string | CommentInputLimitsPatch | null | undefined,
): string {
	return JSON.stringify(mergeCommentInputLimits(settings));
}

export function resolveEngagementTrustMode(
	settings: EngagementSettings,
): EngagementTrustMode {
	return settings.visitors.enabled ? "trusted" : "lightweight";
}

export function buildDefaultSiteSettings(siteId: number) {
	return {
		siteId,
		commentsEnabled: true,
		defaultStatus: "pending",
		maxDepth: 3,
		rootLimit: 20,
		commentRequireJson: JSON.stringify(defaultCommentRequire),
		allowWebsite: true,
		allowPageLike: defaultEngagementSettings.pageLikes.enabled,
		captchaMode: "threshold",
		captchaThresholdWindowSec: 60,
		captchaThresholdMaxActions: 3,
		abuseGuardEnabled: true,
		abuseGuardWindowSec: 600,
		abuseGuardMaxWriteActions: 100,
		autoBlacklistEnabled: true,
		autoBlacklistScope: "post",
		autoBlacklistTtlSec: 1800,
		commentInputLimitsJson: serializeCommentInputLimits(
			defaultCommentInputLimits,
		),
		commentMetadataJson: JSON.stringify(defaultCommentMetadata),
		engagementJson: serializeEngagementSettings(defaultEngagementSettings),
		verifiedAuthorJson: serializeVerifiedAuthorSettings(defaultVerifiedAuthor),
		staffDisplayJson: serializeStaffDisplaySettings(
			defaultStaffDisplaySettings,
		),
		moderationJson: serializeSiteModerationSettings(
			defaultSiteModerationSettings,
		),
		pageRegistryJson: null,
		commenterReplyEmailEnabled: false,
		commenterReplyEmailDefaultChecked: false,
		backendNotificationsEnabled: false,
	};
}
