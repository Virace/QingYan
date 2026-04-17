import { inArray } from "drizzle-orm";

import type { SiteConfig } from "../../config/types";
import type { AppDatabase } from "../../db/client";
import { runtimeSettings } from "../../db/schema/settings";
import { sites } from "../../db/schema/sites";

export interface RegisteredSiteRecord {
	id: number;
	siteKey: string;
	name: string;
	allowedOrigins: string[];
}

function serializeAllowedOrigins(allowedOrigins: string[]): string {
	return JSON.stringify(allowedOrigins);
}

function parseAllowedOrigins(payload: string): string[] {
	const parsed = JSON.parse(payload) as unknown;
	return Array.isArray(parsed)
		? parsed.filter((item): item is string => typeof item === "string")
		: [];
}

function buildRuntimeSettingsInsert(siteId: number, site: SiteConfig) {
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

export class SiteRegistry {
	private readonly configuredSites = new Map<string, SiteConfig>();

	private readonly registeredSites = new Map<string, RegisteredSiteRecord>();

	public constructor(sitesConfig: SiteConfig[]) {
		for (const site of sitesConfig) {
			this.configuredSites.set(site.siteKey, site);
		}
	}

	public getConfiguredSite(siteKey?: string): SiteConfig | undefined {
		return siteKey ? this.configuredSites.get(siteKey) : undefined;
	}

	public getRegisteredSite(siteKey?: string): RegisteredSiteRecord | undefined {
		return siteKey ? this.registeredSites.get(siteKey) : undefined;
	}

	public async sync(db: AppDatabase): Promise<RegisteredSiteRecord[]> {
		const configuredSites = [...this.configuredSites.values()];
		if (configuredSites.length === 0) {
			this.registeredSites.clear();
			return [];
		}

		for (const site of configuredSites) {
			await db
				.insert(sites)
				.values({
					siteKey: site.siteKey,
					name: site.name,
					allowedOriginsJson: serializeAllowedOrigins(site.allowedOrigins),
				})
				.onConflictDoUpdate({
					target: sites.siteKey,
					set: {
						name: site.name,
						allowedOriginsJson: serializeAllowedOrigins(site.allowedOrigins),
						updatedAt: new Date().toISOString(),
					},
				});
		}

		const registeredSites = await db
			.select()
			.from(sites)
			.where(
				inArray(
					sites.siteKey,
					configuredSites.map((site) => site.siteKey),
				),
			);

		this.registeredSites.clear();
		for (const site of registeredSites) {
			this.registeredSites.set(site.siteKey, {
				id: site.id,
				siteKey: site.siteKey,
				name: site.name,
				allowedOrigins: parseAllowedOrigins(site.allowedOriginsJson),
			});
		}

		for (const site of configuredSites) {
			const registeredSite = this.getRegisteredSite(site.siteKey);
			if (!registeredSite) {
				continue;
			}

			await db
				.insert(runtimeSettings)
				.values(buildRuntimeSettingsInsert(registeredSite.id, site))
				.onConflictDoNothing({
					target: runtimeSettings.siteId,
				});
		}

		return [...this.registeredSites.values()];
	}
}

export function createSiteRegistry(sitesConfig: SiteConfig[]): SiteRegistry {
	return new SiteRegistry(sitesConfig);
}
