import { createHash } from "node:crypto";

import type { AppDatabase } from "../../db/client";
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
import {
	PageSourceRepository,
	type PageRegistrySourceRecord,
	type PageSourceMode,
} from "./source-repository";

export type PageSourceRefreshTrigger = "manual" | "scheduled" | "webhook";

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
		options: { timeoutMs?: number; maxBytes?: number },
	) => Promise<string>;
	loadAllowedOriginsForSite: (siteKey: string) => Promise<string[]>;
	createTitleRefreshRun?: (input: {
		siteKey: string;
		pageKeys: string[];
	}) => Promise<unknown>;
}

interface PageSourceRefreshJobScope {
	siteKey: string;
	sourceIds?: number[];
	mode?: PageSourceMode;
	trigger: PageSourceRefreshTrigger;
	timeoutMs?: number;
	maxBytes?: number;
	runAfter?: string | null;
	maxAttempts?: number;
	retryDelaySec?: number;
}

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

function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function addSeconds(date: Date, seconds: number): string {
	return new Date(date.getTime() + seconds * 1000).toISOString();
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
	private readonly repository: PageSourceRepository;
	private readonly pageRegistry: PageRegistryService;

	public constructor(
		db: AppDatabase,
		private readonly options: PageSourceRefreshOptions,
	) {
		this.repository = new PageSourceRepository(db);
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

	public async listDueRefreshInputs(now = new Date()) {
		const dueSources = await this.repository.listDueSources(now.toISOString());
		const bySiteKey = new Map<string, number[]>();
		for (const source of dueSources) {
			const sourceIds = bySiteKey.get(source.siteKey) ?? [];
			sourceIds.push(source.id);
			bySiteKey.set(source.siteKey, sourceIds);
		}

		return Array.from(bySiteKey, ([siteKey, sourceIds]) => ({
			siteKey,
			sourceIds,
			trigger: "scheduled" as const,
		}));
	}

	private async refreshSourcesWithContext(
		scope: PageSourceRefreshJobScope,
		context: Pick<TaskRunnerContext, "log" | "updateProgress" | "signal">,
	) {
		const sources = await this.repository.listEnabledSources({
			sourceIds: scope.sourceIds,
		});
		const selectedSources = sources.filter(
			(source) => source.siteKey === scope.siteKey,
		);
		const counters = emptyCounters();
		const errors: Array<{ sourceId: number; url: string; reason: string }> = [];

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
			await context.updateProgress({
				phase: "refreshing",
				...counters,
			});
		}

		return {
			...counters,
			errors: errors.slice(0, 20),
		};
	}

	private async refreshSource(
		source: PageRegistrySourceRecord,
		scope: PageSourceRefreshJobScope,
	) {
		const now = new Date();
		const nowIso = now.toISOString();
		const counters = emptyCounters();
		const errors: Array<{ sourceId: number; url: string; reason: string }> = [];
		const seenPageRegistryIds: number[] = [];
		const missingTitlePageKeys: string[] = [];
		let approvedPending = 0;

		await this.repository.markSourceAttempt(source.id, nowIso);
		const allowedOrigins = await this.options.loadAllowedOriginsForSite(
			source.siteKey,
		);
		const xml = await this.options.fetchText(source.sourceUrl, {
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
					sourceId: source.id,
					url: entry.url,
					reason: rejectionReason,
				});
				continue;
			}
			const normalized = normalizePageSourceEntry({ entry, allowedOrigins });
			if (!normalized) {
				counters.failed += 1;
				errors.push({
					sourceId: source.id,
					url: entry.url,
					reason: "normalize_failed",
				});
				continue;
			}
			const upsert = await this.repository.upsertRegistryPage({
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
			await this.repository.attachSourcePage({
				sourceId: source.id,
				pageRegistryId: upsert.page.id,
				nowIso,
			});
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

		const mode = scope.mode ?? source.mode;
		if (mode === "replace") {
			counters.stale += await this.repository.markMissingSourcePagesStale({
				sourceId: source.id,
				seenPageRegistryIds,
				nowIso,
			});
		}

		await this.repository.markSourceSuccess({
			sourceId: source.id,
			nowIso,
			hash: hashText(parsed.hashText),
			nextRefreshAt: source.refreshIntervalSec
				? addSeconds(now, source.refreshIntervalSec)
				: null,
		});
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
		};
	}

	private async collectParsedEntries(input: {
		source: PageRegistrySourceRecord;
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
}
