import { createHash } from "node:crypto";

import type { AppDatabase } from "../../db/client";
import type { MaintenanceJobRepository } from "../ops/maintenance-job-repository";
import { AppError } from "../shared/errors";
import { PageRegistryService } from "./service";
import {
	getPageSourceEntryRejectionReason,
	normalizePageSourceEntry,
} from "./source-normalizer";
import { parsePageSourceXml } from "./source-parser";
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
	fetchText: (url: string) => Promise<string>;
	loadAllowedOriginsForSite: (siteKey: string) => Promise<string[]>;
	createTitleRefreshJob?: (input: {
		siteKey: string;
		pageKeys: string[];
	}) => Promise<unknown>;
}

interface PageSourceRefreshJobScope {
	siteKey: string;
	sourceIds?: number[];
	mode?: PageSourceMode;
	trigger: PageSourceRefreshTrigger;
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

export class PageSourceRefreshService {
	private readonly repository: PageSourceRepository;
	private readonly pageRegistry: PageRegistryService;

	public constructor(
		db: AppDatabase,
		private readonly jobs: MaintenanceJobRepository,
		private readonly options: PageSourceRefreshOptions,
	) {
		this.repository = new PageSourceRepository(db);
		this.pageRegistry = new PageRegistryService(db);
	}

	public async createRefreshJob(input: PageSourceRefreshJobScope) {
		const concurrencyKey = `page-source:${input.siteKey}`;
		if (
			await this.jobs.hasActiveJob({
				type: "page_source_refresh",
				concurrencyKey,
			})
		) {
			throw new AppError(
				409,
				"MAINTENANCE_JOB_ALREADY_RUNNING",
				"已有维护任务正在运行。",
			);
		}
		return this.jobs.create({
			type: "page_source_refresh",
			siteKey: input.siteKey,
			scope: input,
			concurrencyKey,
		});
	}

	public async runNextQueuedJob() {
		const active = (await this.jobs.listRecent(20)).find(
			(job) => job.status === "queued" && job.type === "page_source_refresh",
		);
		if (!active) {
			return null;
		}
		await this.jobs.markRunning(active.id, {
			phase: "refreshing",
			...emptyCounters(),
		});
		try {
			const result = await this.refreshSources(
				active.id,
				active.scope as PageSourceRefreshJobScope,
			);
			return this.jobs.markSucceeded(active.id, result);
		} catch (error) {
			return this.jobs.markFailed(active.id, {
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	public async runDueSources(now = new Date()) {
		const dueSources = await this.repository.listDueSources(now.toISOString());
		const bySiteKey = new Map<string, number[]>();
		for (const source of dueSources) {
			const sourceIds = bySiteKey.get(source.siteKey) ?? [];
			sourceIds.push(source.id);
			bySiteKey.set(source.siteKey, sourceIds);
		}

		const jobs = [];
		for (const [siteKey, sourceIds] of bySiteKey) {
			jobs.push(
				await this.createRefreshJob({
					siteKey,
					sourceIds,
					trigger: "scheduled",
				}),
			);
		}
		return jobs;
	}

	private async refreshSources(
		jobId: string,
		scope: PageSourceRefreshJobScope,
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
			const sourceResult = await this.refreshSource(source, scope.mode);
			counters.processed += sourceResult.processed;
			counters.created += sourceResult.created;
			counters.updated += sourceResult.updated;
			counters.stale += sourceResult.stale;
			counters.skipped += sourceResult.skipped;
			counters.failed += sourceResult.failed;
			counters.approvedPending += sourceResult.approvedPending;
			errors.push(...sourceResult.errors);
			await this.jobs.updateProgress(jobId, {
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
		overrideMode?: PageSourceMode,
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
		const xml = await this.options.fetchText(source.sourceUrl);
		const parsed = parsePageSourceXml(xml, source.sourceType);

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

		const mode = overrideMode ?? source.mode;
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
			hash: hashText(xml),
			nextRefreshAt: source.refreshIntervalSec
				? addSeconds(now, source.refreshIntervalSec)
				: null,
		});
		if (missingTitlePageKeys.length > 0) {
			await this.options.createTitleRefreshJob?.({
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
}
