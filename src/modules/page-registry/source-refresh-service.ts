import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { sitePageRegistry, sites } from "../../db/schema";
import type { TaskRunnerContext } from "../tasks/task-runner-context";
import { PageRegistryService } from "./service";
import {
	getPageSourceEntryRejectionReason,
	normalizePageSourceEntry,
} from "./source-normalizer";
import {
	parsePageSourceXml,
	type PageSourceEntry,
	type ParsedPageSource,
} from "./source-parser";

export type PageSourceRefreshTrigger = "manual" | "scheduled" | "webhook";
export type PageSourceMode = "append" | "replace";

export interface PageSourceRefreshCounters {
	processed: number;
	created: number;
	updated: number;
	stale: number;
	skipped: number;
	failed: number;
	approvedPending: number;
}

export interface PageSourceRefreshOptions {
	fetchText: (
		url: string,
		options: {
			allowedOrigins: string[];
			timeoutMs?: number;
			maxBytes?: number;
		},
	) => Promise<string>;
	loadAllowedOriginsForSite: (siteKey: string) => Promise<string[]>;
	createTitleRefreshRun?: (input: {
		siteKey: string;
		pageKeys: string[];
	}) => Promise<unknown>;
}

interface PageSourceRefreshJobScope {
	siteKey: string;
	sitemapUrls: string[];
	mode?: PageSourceMode;
	trigger: PageSourceRefreshTrigger;
	timeoutMs?: number;
	maxBytes?: number;
}

type RefreshablePageSource = {
	siteId: number;
	siteKey: string;
	sourceType: "sitemap";
	sourceUrl: string;
	mode: PageSourceMode;
};

function emptyCounters(): PageSourceRefreshCounters {
	return {
		processed: 0,
		created: 0,
		updated: 0,
		stale: 0,
		skipped: 0,
		failed: 0,
		approvedPending: 0,
	};
}

const MAX_SITEMAP_INDEX_DEPTH = 3;

function normalizeAllowedOrigin(value: string): string | null {
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return null;
		}
		return parsed.origin;
	} catch {
		return null;
	}
}

function assertAllowedSitemapUrl(url: string, allowedOrigins: string[]) {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid sitemap URL: ${url}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Unsupported sitemap URL protocol: ${url}`);
	}
	const allowed = allowedOrigins
		.map((origin) => normalizeAllowedOrigin(origin))
		.some((origin) => origin === parsed.origin);
	if (!allowed) {
		throw new Error(`Sitemap URL is outside allowed origins: ${url}`);
	}
}

export class PageSourceRefreshService {
	private readonly pageRegistry: PageRegistryService;

	public constructor(
		private readonly db: AppDatabase,
		private readonly options: PageSourceRefreshOptions,
	) {
		this.pageRegistry = new PageRegistryService(db);
	}

	public async executeRefresh(
		input: PageSourceRefreshJobScope,
		context: Pick<TaskRunnerContext, "log" | "updateProgress" | "signal">,
	) {
		await context.log.info(`开始刷新页面来源：站点 ${input.siteKey}。`);
		await context.updateProgress({
			phase: "refreshing",
			...emptyCounters(),
		});
		const result = await this.refreshSourcesWithContext(input, context);
		await context.log.info("页面来源刷新完成。", result);
		return result;
	}

	public async listDueRefreshInputs(_now = new Date()) {
		return [];
	}

	private async refreshSourcesWithContext(
		scope: PageSourceRefreshJobScope,
		context: Pick<TaskRunnerContext, "log" | "updateProgress" | "signal">,
	) {
		const selectedSources = await this.listSelectedSources(scope);
		const counters = emptyCounters();
		const errors: Array<{
			url: string;
			reason: string;
		}> = [];
		const seenPageRegistryIds = new Set<number>();
		const siteId = selectedSources[0]?.siteId;

		for (const source of selectedSources) {
			if (context.signal?.aborted) {
				throw new Error("Task run aborted.");
			}
			await context.log.info(`刷新页面来源：${source.sourceUrl}`);
			const sourceResult = await this.refreshSource(source, scope);
			counters.processed += sourceResult.processed;
			counters.created += sourceResult.created;
			counters.updated += sourceResult.updated;
			counters.stale += sourceResult.stale;
			counters.skipped += sourceResult.skipped;
			counters.failed += sourceResult.failed;
			counters.approvedPending += sourceResult.approvedPending;
			errors.push(...sourceResult.errors);
			for (const pageId of sourceResult.seenPageRegistryIds) {
				seenPageRegistryIds.add(pageId);
			}
			await context.updateProgress({
				phase: "refreshing",
				...counters,
			});
		}
		if ((scope.mode ?? "replace") === "replace" && siteId !== undefined) {
			counters.stale += await this.markMissingSitePagesStale({
				siteId,
				seenPageRegistryIds: Array.from(seenPageRegistryIds),
				nowIso: new Date().toISOString(),
			});
		}

		return {
			...counters,
			errors: errors.slice(0, 20),
		};
	}

	private async listSelectedSources(
		scope: PageSourceRefreshJobScope,
	): Promise<RefreshablePageSource[]> {
		const [site] = await this.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, scope.siteKey))
			.limit(1);
		if (!site) {
			throw new Error(
				`Site not found for page source refresh: ${scope.siteKey}`,
			);
		}
		const allowedOrigins = await this.options.loadAllowedOriginsForSite(
			site.siteKey,
		);
		for (const sourceUrl of scope.sitemapUrls) {
			assertAllowedSitemapUrl(sourceUrl, allowedOrigins);
		}
		return scope.sitemapUrls.map((sourceUrl) => ({
			siteId: site.id,
			siteKey: site.siteKey,
			sourceType: "sitemap",
			sourceUrl,
			mode: scope.mode ?? "replace",
		}));
	}

	private async refreshSource(
		source: RefreshablePageSource,
		scope: PageSourceRefreshJobScope,
	) {
		const now = new Date();
		const nowIso = now.toISOString();
		const counters = emptyCounters();
		const errors: Array<{
			url: string;
			reason: string;
		}> = [];
		const seenPageRegistryIds: number[] = [];
		const missingTitlePageKeys: string[] = [];
		let approvedPending = 0;

		const allowedOrigins = await this.options.loadAllowedOriginsForSite(
			source.siteKey,
		);
		const xml = await this.options.fetchText(source.sourceUrl, {
			allowedOrigins,
			timeoutMs: scope.timeoutMs,
			maxBytes: scope.maxBytes,
		});
		const parsed = await this.collectParsedEntries({
			source,
			scope,
			xml,
			allowedOrigins,
		});

		for (const entry of parsed.entries) {
			counters.processed += 1;
			const rejectionReason = getPageSourceEntryRejectionReason({
				entry,
				allowedOrigins,
			});
			if (rejectionReason) {
				counters.failed += 1;
				errors.push({
					url: entry.url,
					reason: rejectionReason,
				});
				continue;
			}
			const normalized = normalizePageSourceEntry({ entry, allowedOrigins });
			if (!normalized) {
				counters.failed += 1;
				errors.push({
					url: entry.url,
					reason: "normalize_failed",
				});
				continue;
			}
			const upsert = await this.upsertRegistryPage({
				siteId: source.siteId,
				pageKey: normalized.pageKey,
				pageUrl: normalized.pageUrl,
				title: normalized.title ?? null,
				nowIso,
			});
			if (!normalized.title && !upsert.page.title) {
				missingTitlePageKeys.push(normalized.pageKey);
			}
			seenPageRegistryIds.push(upsert.page.id);
			const approved = await this.pageRegistry.approvePendingCandidateIfPending(
				{
					siteId: source.siteId,
					siteKey: source.siteKey,
					pageKey: normalized.pageKey,
					pageUrl: normalized.pageUrl,
				},
			);
			if (approved) {
				approvedPending += 1;
			}
			if (upsert.action === "created") {
				counters.created += 1;
			} else if (upsert.action === "updated" || upsert.action === "unchanged") {
				counters.updated += 1;
			} else {
				counters.skipped += 1;
			}
		}

		if (missingTitlePageKeys.length > 0) {
			await this.options.createTitleRefreshRun?.({
				siteKey: source.siteKey,
				pageKeys: Array.from(new Set(missingTitlePageKeys)),
			});
		}

		return {
			...counters,
			approvedPending,
			errors,
			seenPageRegistryIds,
		};
	}

	private async collectParsedEntries(input: {
		source: RefreshablePageSource;
		scope: PageSourceRefreshJobScope;
		xml: string;
		allowedOrigins: string[];
	}): Promise<{ entries: PageSourceEntry[]; hashText: string }> {
		const rootParsed = parsePageSourceXml(input.xml, input.source.sourceType);
		if (
			input.source.sourceType !== "sitemap" ||
			rootParsed.sitemapUrls.length === 0
		) {
			return { entries: rootParsed.entries, hashText: input.xml };
		}

		const visitedSitemapUrls = new Set([input.source.sourceUrl]);
		const entries: PageSourceEntry[] = [...rootParsed.entries];
		const hashParts = [input.xml];
		await this.collectSitemapIndexEntries({
			sitemapUrls: rootParsed.sitemapUrls,
			scope: input.scope,
			allowedOrigins: input.allowedOrigins,
			visitedSitemapUrls,
			entries,
			hashParts,
			depth: 1,
		});

		return { entries, hashText: hashParts.join("\n") };
	}

	private async collectSitemapIndexEntries(input: {
		sitemapUrls: string[];
		scope: PageSourceRefreshJobScope;
		allowedOrigins: string[];
		visitedSitemapUrls: Set<string>;
		entries: PageSourceEntry[];
		hashParts: string[];
		depth: number;
	}) {
		if (input.depth > MAX_SITEMAP_INDEX_DEPTH) {
			throw new Error("Sitemap index nesting is too deep.");
		}

		for (const sitemapUrl of input.sitemapUrls) {
			if (input.visitedSitemapUrls.has(sitemapUrl)) {
				continue;
			}
			assertAllowedSitemapUrl(sitemapUrl, input.allowedOrigins);
			input.visitedSitemapUrls.add(sitemapUrl);
			const xml = await this.options.fetchText(sitemapUrl, {
				allowedOrigins: input.allowedOrigins,
				timeoutMs: input.scope.timeoutMs,
				maxBytes: input.scope.maxBytes,
			});
			input.hashParts.push(xml);
			const parsed: ParsedPageSource = parsePageSourceXml(xml, "sitemap");
			input.entries.push(...parsed.entries);
			if (parsed.sitemapUrls.length > 0) {
				await this.collectSitemapIndexEntries({
					...input,
					sitemapUrls: parsed.sitemapUrls,
					depth: input.depth + 1,
				});
			}
		}
	}

	private async upsertRegistryPage(input: {
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

	private async markMissingSitePagesStale(input: {
		siteId: number;
		seenPageRegistryIds: number[];
		nowIso: string;
	}) {
		const rows = await this.db
			.select({
				id: sitePageRegistry.id,
				status: sitePageRegistry.status,
			})
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.siteId, input.siteId));
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
}
