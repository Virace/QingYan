export type CommentMetadataSettings = {
	collectIp: boolean;
	collectUserAgent: boolean;
	ipRegion: {
		enabled: boolean;
		cachePolicy: "file" | "vectorIndex" | "content";
		precision: "country" | "province" | "city";
		autoUpdate: {
			enabled: boolean;
			schedule: "monthly";
		};
		ipv4: {
			dbPath: string;
			sources: string[];
		};
		ipv6: {
			dbPath: string;
			sources: string[];
		};
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
		cachePolicy: "vectorIndex",
		precision: "province",
		autoUpdate: {
			enabled: false,
			schedule: "monthly",
		},
		ipv4: {
			dbPath: "./data/ip2region_v4.xdb",
			sources: [
				"https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb",
				"https://gitee.com/lionsoul/ip2region/raw/master/data/ip2region_v4.xdb",
			],
		},
		ipv6: {
			dbPath: "./data/ip2region_v6.xdb",
			sources: [
				"https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v6.xdb",
				"https://gitee.com/lionsoul/ip2region/raw/master/data/ip2region_v6.xdb",
			],
		},
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
		emailNotificationsEnabled: false,
	};
}
