import { and, eq, inArray, lte } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	sitePageRegistry,
	sitePageRegistrySourcePages,
	sitePageRegistrySources,
	sites,
} from "../../db/schema";

export type PageSourceType = "sitemap" | "rss" | "atom";
export type PageSourceMode = "append" | "replace";

export interface PageRegistrySourceRecord {
	id: number;
	siteId: number;
	siteKey: string;
	sourceType: PageSourceType;
	sourceUrl: string;
	enabled: boolean;
	mode: PageSourceMode;
	refreshIntervalSec: number | null;
	lastAttemptAt: string | null;
	lastSuccessAt: string | null;
	lastSuccessHash: string | null;
	lastError: string | null;
	nextRefreshAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export type RegistryPageUpsertAction =
	| "created"
	| "updated"
	| "unchanged"
	| "skipped_protected";

function parseSourceRow(row: {
	id: number;
	siteId: number;
	siteKey: string;
	sourceType: string;
	sourceUrl: string;
	enabled: boolean;
	mode: string;
	refreshIntervalSec: number | null;
	lastAttemptAt: string | null;
	lastSuccessAt: string | null;
	lastSuccessHash: string | null;
	lastError: string | null;
	nextRefreshAt: string | null;
	createdAt: string;
	updatedAt: string;
}): PageRegistrySourceRecord {
	return {
		...row,
		sourceType: row.sourceType as PageSourceType,
		mode: row.mode as PageSourceMode,
	};
}

export class PageSourceRepository {
	public constructor(private readonly db: AppDatabase) {}

	public async listSources(input: { siteId?: number; siteKey?: string } = {}) {
		const rows = await this.db
			.select({
				id: sitePageRegistrySources.id,
				siteId: sitePageRegistrySources.siteId,
				siteKey: sites.siteKey,
				sourceType: sitePageRegistrySources.sourceType,
				sourceUrl: sitePageRegistrySources.sourceUrl,
				enabled: sitePageRegistrySources.enabled,
				mode: sitePageRegistrySources.mode,
				refreshIntervalSec: sitePageRegistrySources.refreshIntervalSec,
				lastAttemptAt: sitePageRegistrySources.lastAttemptAt,
				lastSuccessAt: sitePageRegistrySources.lastSuccessAt,
				lastSuccessHash: sitePageRegistrySources.lastSuccessHash,
				lastError: sitePageRegistrySources.lastError,
				nextRefreshAt: sitePageRegistrySources.nextRefreshAt,
				createdAt: sitePageRegistrySources.createdAt,
				updatedAt: sitePageRegistrySources.updatedAt,
			})
			.from(sitePageRegistrySources)
			.innerJoin(sites, eq(sites.id, sitePageRegistrySources.siteId))
			.where(
				and(
					input.siteId
						? eq(sitePageRegistrySources.siteId, input.siteId)
						: undefined,
					input.siteKey ? eq(sites.siteKey, input.siteKey) : undefined,
				),
			)
			.orderBy(sitePageRegistrySources.id);
		return rows.map(parseSourceRow);
	}

	public async createSource(input: {
		siteId: number;
		sourceType: PageSourceType;
		sourceUrl: string;
		enabled: boolean;
		mode: PageSourceMode;
		refreshIntervalSec?: number | null;
	}) {
		const nowIso = new Date().toISOString();
		await this.db.insert(sitePageRegistrySources).values({
			siteId: input.siteId,
			sourceType: input.sourceType,
			sourceUrl: input.sourceUrl,
			enabled: input.enabled,
			mode: input.mode,
			refreshIntervalSec: input.refreshIntervalSec ?? null,
			createdAt: nowIso,
			updatedAt: nowIso,
		});
		const [source] = await this.listSources({ siteId: input.siteId });
		const created = (await this.listSources({ siteId: input.siteId })).find(
			(item) => item.sourceUrl === input.sourceUrl,
		);
		return created ?? source;
	}

	public async updateSource(input: {
		sourceId: number;
		patch: Partial<{
			sourceType: PageSourceType;
			sourceUrl: string;
			enabled: boolean;
			mode: PageSourceMode;
			refreshIntervalSec: number | null;
			nextRefreshAt: string | null;
		}>;
	}) {
		await this.db
			.update(sitePageRegistrySources)
			.set({ ...input.patch, updatedAt: new Date().toISOString() })
			.where(eq(sitePageRegistrySources.id, input.sourceId));
		return this.getSource(input.sourceId);
	}

	public async deleteSource(sourceId: number) {
		await this.db
			.delete(sitePageRegistrySourcePages)
			.where(eq(sitePageRegistrySourcePages.sourceId, sourceId));
		await this.db
			.delete(sitePageRegistrySources)
			.where(eq(sitePageRegistrySources.id, sourceId));
	}

	public async getSource(sourceId: number) {
		const sources = await this.listEnabledSources({ sourceIds: [sourceId] });
		return sources[0] ?? null;
	}

	public async listEnabledSources(input: {
		siteId?: number;
		sourceIds?: number[];
	}) {
		const rows = await this.listSources({ siteId: input.siteId });
		return rows.filter(
			(source) =>
				source.enabled &&
				(input.sourceIds === undefined || input.sourceIds.includes(source.id)),
		);
	}

	public async listDueSources(nowIso: string) {
		const rows = await this.db
			.select({
				id: sitePageRegistrySources.id,
				siteId: sitePageRegistrySources.siteId,
				siteKey: sites.siteKey,
				sourceType: sitePageRegistrySources.sourceType,
				sourceUrl: sitePageRegistrySources.sourceUrl,
				enabled: sitePageRegistrySources.enabled,
				mode: sitePageRegistrySources.mode,
				refreshIntervalSec: sitePageRegistrySources.refreshIntervalSec,
				lastAttemptAt: sitePageRegistrySources.lastAttemptAt,
				lastSuccessAt: sitePageRegistrySources.lastSuccessAt,
				lastSuccessHash: sitePageRegistrySources.lastSuccessHash,
				lastError: sitePageRegistrySources.lastError,
				nextRefreshAt: sitePageRegistrySources.nextRefreshAt,
				createdAt: sitePageRegistrySources.createdAt,
				updatedAt: sitePageRegistrySources.updatedAt,
			})
			.from(sitePageRegistrySources)
			.innerJoin(sites, eq(sites.id, sitePageRegistrySources.siteId))
			.where(
				and(
					eq(sitePageRegistrySources.enabled, true),
					lte(sitePageRegistrySources.nextRefreshAt, nowIso),
				),
			);
		return rows.map(parseSourceRow);
	}

	public async upsertRegistryPage(input: {
		siteId: number;
		pageKey: string;
		pageUrl: string;
		title?: string | null;
		nowIso: string;
	}) {
		const [existing] = await this.db
			.select()
			.from(sitePageRegistry)
			.where(
				and(
					eq(sitePageRegistry.siteId, input.siteId),
					eq(sitePageRegistry.pageKey, input.pageKey),
				),
			)
			.limit(1);

		if (!existing) {
			await this.db.insert(sitePageRegistry).values({
				siteId: input.siteId,
				pageKey: input.pageKey,
				pageUrl: input.pageUrl,
				title: input.title ?? null,
				status: "active",
				firstSeenAt: input.nowIso,
				lastSeenAt: input.nowIso,
				createdAt: input.nowIso,
				updatedAt: input.nowIso,
			});
			const [page] = await this.db
				.select()
				.from(sitePageRegistry)
				.where(
					and(
						eq(sitePageRegistry.siteId, input.siteId),
						eq(sitePageRegistry.pageKey, input.pageKey),
					),
				)
				.limit(1);
			return { page, action: "created" as const };
		}

		const protectedStatus = ["trash", "deleted", "ignored"].includes(
			existing.status,
		);
		await this.db
			.update(sitePageRegistry)
			.set({
				pageUrl: input.pageUrl,
				title: input.title ?? existing.title,
				lastSeenAt: input.nowIso,
				updatedAt: input.nowIso,
			})
			.where(eq(sitePageRegistry.id, existing.id));
		const [page] = await this.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.id, existing.id))
			.limit(1);

		if (protectedStatus) {
			return { page, action: "skipped_protected" as const };
		}
		return {
			page,
			action:
				existing.pageUrl === input.pageUrl &&
				existing.title === (input.title ?? null)
					? ("unchanged" as const)
					: ("updated" as const),
		};
	}

	public async attachSourcePage(input: {
		sourceId: number;
		pageRegistryId: number;
		nowIso: string;
	}) {
		await this.db
			.insert(sitePageRegistrySourcePages)
			.values({
				sourceId: input.sourceId,
				pageRegistryId: input.pageRegistryId,
				firstSeenAt: input.nowIso,
				lastSeenAt: input.nowIso,
				createdAt: input.nowIso,
				updatedAt: input.nowIso,
			})
			.onConflictDoUpdate({
				target: [
					sitePageRegistrySourcePages.sourceId,
					sitePageRegistrySourcePages.pageRegistryId,
				],
				set: {
					lastSeenAt: input.nowIso,
					updatedAt: input.nowIso,
				},
			});
	}

	public async markMissingSourcePagesStale(input: {
		sourceId: number;
		seenPageRegistryIds: number[];
		nowIso: string;
	}) {
		const rows = await this.db
			.select({
				id: sitePageRegistrySourcePages.pageRegistryId,
				status: sitePageRegistry.status,
			})
			.from(sitePageRegistrySourcePages)
			.innerJoin(
				sitePageRegistry,
				eq(sitePageRegistry.id, sitePageRegistrySourcePages.pageRegistryId),
			)
			.where(eq(sitePageRegistrySourcePages.sourceId, input.sourceId));
		const missingIds = rows
			.filter((row) => !input.seenPageRegistryIds.includes(row.id))
			.filter((row) => !["trash", "deleted", "ignored"].includes(row.status))
			.map((row) => row.id);
		if (missingIds.length === 0) {
			return 0;
		}
		await this.db
			.update(sitePageRegistry)
			.set({ status: "stale", updatedAt: input.nowIso })
			.where(inArray(sitePageRegistry.id, missingIds));
		return missingIds.length;
	}

	public async markSourceAttempt(sourceId: number, nowIso: string) {
		await this.db
			.update(sitePageRegistrySources)
			.set({ lastAttemptAt: nowIso, lastError: null, updatedAt: nowIso })
			.where(eq(sitePageRegistrySources.id, sourceId));
	}

	public async markSourceSuccess(input: {
		sourceId: number;
		nowIso: string;
		hash?: string | null;
		nextRefreshAt?: string | null;
	}) {
		await this.db
			.update(sitePageRegistrySources)
			.set({
				lastSuccessAt: input.nowIso,
				lastSuccessHash: input.hash ?? null,
				lastError: null,
				nextRefreshAt: input.nextRefreshAt ?? null,
				updatedAt: input.nowIso,
			})
			.where(eq(sitePageRegistrySources.id, input.sourceId));
	}

	public async markSourceError(input: {
		sourceId: number;
		nowIso: string;
		error: string;
	}) {
		await this.db
			.update(sitePageRegistrySources)
			.set({
				lastError: input.error,
				updatedAt: input.nowIso,
			})
			.where(eq(sitePageRegistrySources.id, input.sourceId));
	}
}
