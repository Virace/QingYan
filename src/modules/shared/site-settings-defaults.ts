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
		enabled: false,
	},
	pageLikes: {
		enabled: false,
	},
	commentVotes: {
		enabled: false,
	},
};

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

export function mergeEngagementSettings(
	value?: string | EngagementSettingsPatch | null,
): EngagementSettings {
	let parsed: EngagementSettingsPatch = {};
	if (typeof value === "string" && value.trim()) {
		try {
			parsed = JSON.parse(value) as EngagementSettingsPatch;
		} catch {
			parsed = {};
		}
	} else if (typeof value === "object" && value !== null) {
		parsed = value;
	}

	return {
		visitors: {
			enabled:
				parsed.visitors?.enabled ?? defaultEngagementSettings.visitors.enabled,
		},
		pageViews: {
			enabled:
				parsed.pageViews?.enabled ??
				defaultEngagementSettings.pageViews.enabled,
		},
		pageLikes: {
			enabled:
				parsed.pageLikes?.enabled ??
				defaultEngagementSettings.pageLikes.enabled,
		},
		commentVotes: {
			enabled:
				parsed.commentVotes?.enabled ??
				defaultEngagementSettings.commentVotes.enabled,
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
		commentMetadataJson: JSON.stringify(defaultCommentMetadata),
		engagementJson: serializeEngagementSettings(defaultEngagementSettings),
		verifiedAuthorJson: serializeVerifiedAuthorSettings(defaultVerifiedAuthor),
		staffDisplayJson: serializeStaffDisplaySettings(
			defaultStaffDisplaySettings,
		),
		moderationJson: serializeSiteModerationSettings(
			defaultSiteModerationSettings,
		),
		emailNotificationsEnabled: false,
	};
}
