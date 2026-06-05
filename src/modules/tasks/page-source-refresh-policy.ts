import { eq } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { siteSettings } from "../../db/schema";
import { mergePageRegistrySettings } from "../shared/page-registry-settings";
import type { SiteRegistry } from "../shared/site-registry";
import { authoritativePageSourceRefreshSystemKey } from "./system-managed-task-service";

export type PageSourceRefreshPolicyResult = "ok" | "blocked";

export interface PageSourceRefreshPolicyInput {
	siteKey?: string | null;
	systemKey?: string | null;
	payload?: unknown;
}

export function readPageSourceRefreshSiteKey(payload: unknown): string | null {
	if (!payload || typeof payload !== "object" || !("siteKey" in payload)) {
		return null;
	}
	const siteKey = (payload as Record<string, unknown>).siteKey;
	return typeof siteKey === "string" && siteKey.length > 0 ? siteKey : null;
}

export class PageSourceRefreshPolicyService {
	public constructor(
		private readonly db: AppDatabase,
		private readonly siteRegistry: SiteRegistry,
	) {}

	public async checkRefreshAllowed(
		input: PageSourceRefreshPolicyInput,
	): Promise<PageSourceRefreshPolicyResult> {
		const siteKey =
			input.siteKey ?? readPageSourceRefreshSiteKey(input.payload);
		if (!siteKey) {
			return "ok";
		}
		if (input.systemKey === authoritativePageSourceRefreshSystemKey(siteKey)) {
			return "ok";
		}
		const site = this.siteRegistry.getRegisteredSite(siteKey);
		if (!site) {
			return "ok";
		}
		const [settings] = await this.db
			.select()
			.from(siteSettings)
			.where(eq(siteSettings.siteId, site.id))
			.limit(1);
		const pageRegistry = mergePageRegistrySettings(
			settings?.pageRegistryJson ?? null,
		);
		return pageRegistry.mode === "authoritative" ? "blocked" : "ok";
	}
}
