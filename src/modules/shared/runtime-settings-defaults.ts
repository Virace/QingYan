import type { SiteConfig } from "../../config/types";

export function buildRuntimeSettingsDefaults(siteId: number, site: SiteConfig) {
	return {
		siteId,
		commentsEnabled: site.defaults.comments.enabled,
		defaultStatus: site.defaults.comments.defaultStatus,
		maxDepth: site.defaults.comments.maxDepth,
		rootLimit: site.defaults.comments.rootLimit,
		commentRequireJson: JSON.stringify(site.defaults.comments.identity.require),
		allowWebsite: site.defaults.comments.allowWebsite,
		allowPageLike: site.defaults.pageFeedback.allowLike,
		captchaMode: site.defaults.comments.captcha.mode,
		captchaThresholdWindowSec:
			site.defaults.comments.captcha.thresholdWindowSec,
		captchaThresholdMaxActions:
			site.defaults.comments.captcha.thresholdMaxActions,
		abuseGuardEnabled: site.defaults.comments.abuseGuard.enabled,
		abuseGuardWindowSec: site.defaults.comments.abuseGuard.windowSec,
		abuseGuardMaxWriteActions:
			site.defaults.comments.abuseGuard.maxWriteActions,
		autoBlacklistEnabled:
			site.defaults.comments.abuseGuard.autoBlacklist.enabled,
		autoBlacklistScope: site.defaults.comments.abuseGuard.autoBlacklist.scope,
		autoBlacklistTtlSec: site.defaults.comments.abuseGuard.autoBlacklist.ttlSec,
		emailNotificationsEnabled: site.defaults.notifications.emailEnabled,
	};
}
