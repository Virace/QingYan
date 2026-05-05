import type { SiteConfig } from "../../config/types";
import type { AppDatabase } from "../../db/client";
import { eq } from "drizzle-orm";
import { siteSettings } from "../../db/schema/settings";
import { sites } from "../../db/schema/sites";
import { buildDefaultSiteSettings } from "./site-settings-defaults";

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

export class SiteRegistry {
	private readonly registeredSites = new Map<string, RegisteredSiteRecord>();

	public getRegisteredSite(siteKey?: string): RegisteredSiteRecord | undefined {
		return siteKey ? this.registeredSites.get(siteKey) : undefined;
	}

	public listRegisteredSites(): RegisteredSiteRecord[] {
		return [...this.registeredSites.values()];
	}

	public async loadFromDatabase(
		db: AppDatabase,
	): Promise<RegisteredSiteRecord[]> {
		this.registeredSites.clear();

		const registeredSites = await db.select().from(sites);

		for (const site of registeredSites) {
			this.registeredSites.set(site.siteKey, {
				id: site.id,
				siteKey: site.siteKey,
				name: site.name,
				allowedOrigins: parseAllowedOrigins(site.allowedOriginsJson),
			});
		}

		return [...this.registeredSites.values()];
	}

	public async seedSiteFromTemplate(
		db: AppDatabase,
		site: Pick<SiteConfig, "siteKey" | "name" | "allowedOrigins">,
	): Promise<RegisteredSiteRecord> {
		await db
			.insert(sites)
			.values({
				siteKey: site.siteKey,
				name: site.name,
				allowedOriginsJson: serializeAllowedOrigins(site.allowedOrigins),
			})
			.onConflictDoNothing({
				target: sites.siteKey,
			});

		const [registeredSite] = await db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, site.siteKey))
			.limit(1);
		if (!registeredSite) {
			throw new Error("Expected seeded site row to exist.");
		}

		await db
			.insert(siteSettings)
			.values(buildDefaultSiteSettings(registeredSite.id))
			.onConflictDoNothing({
				target: siteSettings.siteId,
			});

		return {
			id: registeredSite.id,
			siteKey: registeredSite.siteKey,
			name: registeredSite.name,
			allowedOrigins: parseAllowedOrigins(registeredSite.allowedOriginsJson),
		};
	}
}

export function createSiteRegistry(): SiteRegistry {
	return new SiteRegistry();
}
