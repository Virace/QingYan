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

export function buildDefaultSiteSettings(siteId: number) {
	return {
		siteId,
		commentsEnabled: true,
		defaultStatus: "pending",
		maxDepth: 3,
		rootLimit: 20,
		commentRequireJson: JSON.stringify(defaultCommentRequire),
		allowWebsite: true,
		allowPageLike: true,
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
