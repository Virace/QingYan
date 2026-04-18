import { inArray } from "drizzle-orm";

import type { SiteConfig } from "../../config/types";
import type { AppDatabase } from "../../db/client";
import { runtimeSettings } from "../../db/schema/settings";
import { sites } from "../../db/schema/sites";
import { buildRuntimeSettingsDefaults } from "./runtime-settings-defaults";

export interface RegisteredSiteRecord {
	id: number;
	siteKey: string;
	name: string;
	allowedOrigins: string[];
	runtimeOnly?: boolean;
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

export class SiteRegistry {
	private readonly configuredSites = new Map<string, SiteConfig>();

	private readonly registeredSites = new Map<string, RegisteredSiteRecord>();

	private readonly runtimeOnlySiteKeys = new Set<string>();

	public constructor(
		sitesConfig: SiteConfig[],
		runtimeOnlySiteKeys: Iterable<string> = [],
	) {
		for (const siteKey of runtimeOnlySiteKeys) {
			this.runtimeOnlySiteKeys.add(siteKey);
		}

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

	public listConfiguredSites(): SiteConfig[] {
		return [...this.configuredSites.values()];
	}

	public listRegisteredSites(): RegisteredSiteRecord[] {
		return [...this.registeredSites.values()];
	}

	public async sync(db: AppDatabase): Promise<RegisteredSiteRecord[]> {
		const configuredSites = [...this.configuredSites.values()];
		const persistentSites = configuredSites.filter(
			(site) => !this.runtimeOnlySiteKeys.has(site.siteKey),
		);

		this.registeredSites.clear();
		if (persistentSites.length === 0) {
			for (const site of configuredSites) {
				if (!this.runtimeOnlySiteKeys.has(site.siteKey)) {
					continue;
				}

				this.registeredSites.set(site.siteKey, {
					id: 0,
					siteKey: site.siteKey,
					name: site.name,
					allowedOrigins: [...site.allowedOrigins],
					runtimeOnly: true,
				});
			}

			return [...this.registeredSites.values()];
		}

		for (const site of persistentSites) {
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
					persistentSites.map((site) => site.siteKey),
				),
			);

		for (const site of registeredSites) {
			this.registeredSites.set(site.siteKey, {
				id: site.id,
				siteKey: site.siteKey,
				name: site.name,
				allowedOrigins: parseAllowedOrigins(site.allowedOriginsJson),
			});
		}

		for (const site of persistentSites) {
			const registeredSite = this.getRegisteredSite(site.siteKey);
			if (!registeredSite) {
				continue;
			}

			await db
				.insert(runtimeSettings)
				.values(buildRuntimeSettingsDefaults(registeredSite.id, site))
				.onConflictDoNothing({
					target: runtimeSettings.siteId,
				});
		}

		for (const site of configuredSites) {
			if (!this.runtimeOnlySiteKeys.has(site.siteKey)) {
				continue;
			}

			this.registeredSites.set(site.siteKey, {
				id: 0,
				siteKey: site.siteKey,
				name: site.name,
				allowedOrigins: [...site.allowedOrigins],
				runtimeOnly: true,
			});
		}

		return [...this.registeredSites.values()];
	}
}

export function createSiteRegistry(
	sitesConfig: SiteConfig[],
	options?: {
		runtimeOnlySiteKeys?: Iterable<string>;
	},
): SiteRegistry {
	return new SiteRegistry(sitesConfig, options?.runtimeOnlySiteKeys);
}
