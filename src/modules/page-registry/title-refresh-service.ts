import { and, eq, inArray, isNull } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { sitePageRegistry, sites } from "../../db/schema";
import type { MaintenanceJobRepository } from "../ops/maintenance-job-repository";
import { defaultTaskQueueSettings } from "../ops/task-settings";
import { AppError, ResourceNotFoundError } from "../shared/errors";

type PageStatus =
	| "active"
	| "stale"
	| "unreachable"
	| "not_found"
	| "trash"
	| "deleted"
	| "ignored";

type PageMetadataRefreshTrigger = "manual" | "source_refresh" | "scheduled";

export interface PageMetadataRefreshScope {
	siteKey: string;
	pageKeys?: string[];
	sourceIds?: number[];
	onlyMissingTitle?: boolean;
	forceTitle?: boolean;
	trigger: PageMetadataRefreshTrigger;
	batchSize?: number;
	runAfter?: string | null;
	maxAttempts?: number;
	retryDelaySec?: number;
	timeoutMs?: number;
	maxBytes?: number;
}

export interface PageMetadataRefreshOptions {
	fetchHtml: (
		url: string,
		options: { timeoutMs: number; maxBytes: number },
	) => Promise<{ status: number; text: string }>;
	now?: () => Date;
	settings?: {
		batchSize: number;
		timeoutMs: number;
		maxBytes: number;
	};
}

interface RefreshRow {
	id: number;
	siteKey: string;
	allowedOriginsJson: string;
	pageKey: string;
	pageUrl: string;
	title: string | null;
	status: string;
}

interface RefreshOneResult {
	ok: boolean;
	error?: string;
}

const PROTECTED_STATUSES = new Set(["trash", "deleted", "ignored"]);
const SYSTEM_STATUSES = new Set([
	"active",
	"stale",
	"unreachable",
	"not_found",
]);

function normalizeTitle(raw: string): string | null {
	const title = raw
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replace(/\s+/g, " ")
		.trim();
	return title.length > 0 ? title : null;
}

function parseHtmlTitle(html: string): string | null {
	const match = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(html);
	return match ? normalizeTitle(match[1] ?? "") : null;
}

function parseAllowedOrigins(json: string): string[] {
	try {
		const parsed = JSON.parse(json) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

function resolvePageUrl(pageUrl: string, allowedOrigins: string[]): string {
	const parsed = new URL(pageUrl, allowedOrigins[0]);
	if (!allowedOrigins.includes(parsed.origin)) {
		throw new AppError(
			400,
			"PAGE_TITLE_ORIGIN_NOT_ALLOWED",
			"页面 title 刷新 URL 必须属于站点允许的 Origin。",
		);
	}
	return parsed.toString();
}

function successStatus(current: string): PageStatus {
	return SYSTEM_STATUSES.has(current) ? "active" : (current as PageStatus);
}

function failureStatus(current: string, statusCode: number | null): PageStatus {
	if (PROTECTED_STATUSES.has(current)) {
		return current as PageStatus;
	}
	return statusCode === 404 ? "not_found" : "unreachable";
}

export class PageMetadataRefreshService {
	public constructor(
		private readonly db: AppDatabase,
		private readonly jobs: MaintenanceJobRepository,
		private readonly options: PageMetadataRefreshOptions,
	) {}

	public async createRefreshJob(input: PageMetadataRefreshScope) {
		const concurrencyKey =
			input.pageKeys?.length === 1
				? `page-title:${input.siteKey}:${input.pageKeys[0]}`
				: `page-title:${input.siteKey}`;
		return this.jobs.create({
			type: "page_metadata_refresh",
			siteKey: input.siteKey,
			scope: input,
			runAfter: input.runAfter ?? null,
			maxAttempts:
				input.maxAttempts ?? defaultTaskQueueSettings.defaultRetry.maxAttempts,
			retryDelaySec:
				input.retryDelaySec ??
				defaultTaskQueueSettings.defaultRetry.retryDelaySec,
			concurrencyKey,
		});
	}

	public async runNextQueuedJob() {
		const [job] = await this.jobs.listRunnable({
			limit: 1,
			maxConcurrentTotal: 1,
			maxConcurrentByType: { page_metadata_refresh: 1 },
		});
		if (!job || job.type !== "page_metadata_refresh") {
			return null;
		}
		await this.jobs.markRunning(job.id, {
			phase: "refreshing_titles",
			processed: 0,
			updated: 0,
			skipped: 0,
			failed: 0,
		});
		try {
			const result = await this.refreshTitles(
				job.id,
				job.scope as PageMetadataRefreshScope,
			);
			return this.jobs.markSucceeded(job.id, result);
		} catch (error) {
			return this.jobs.markFailedOrRetry(job.id, {
				error: {
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	private async refreshTitles(jobId: string, scope: PageMetadataRefreshScope) {
		const rows = await this.listRows(scope);
		let processed = 0;
		let updated = 0;
		let skipped = 0;
		let failed = 0;
		const errors: Array<{ pageKey: string; message: string }> = [];
		const batchSize =
			scope.batchSize ??
			this.options.settings?.batchSize ??
			defaultTaskQueueSettings.pageTitleRefresh.batchSize;

		for (const row of rows.slice(0, batchSize)) {
			processed += 1;
			try {
				if (scope.onlyMissingTitle && row.title && !scope.forceTitle) {
					skipped += 1;
					continue;
				}
				const result = await this.refreshOne(row, scope);
				if (result.ok) {
					updated += 1;
				} else {
					failed += 1;
					errors.push({
						pageKey: row.pageKey,
						message: result.error ?? "title_refresh_failed",
					});
				}
			} catch (error) {
				failed += 1;
				const message = error instanceof Error ? error.message : String(error);
				errors.push({ pageKey: row.pageKey, message });
			}
			await this.jobs.updateProgress(jobId, {
				phase: "refreshing_titles",
				total: rows.length,
				processed,
				updated,
				skipped,
				failed,
			});
		}

		return {
			processed,
			updated,
			skipped,
			failed,
			errors: errors.slice(0, 20),
		};
	}

	private async refreshOne(
		row: RefreshRow,
		scope: PageMetadataRefreshScope,
	): Promise<RefreshOneResult> {
		const nowIso = this.nowIso();
		const allowedOrigins = parseAllowedOrigins(row.allowedOriginsJson);
		const fullUrl = resolvePageUrl(row.pageUrl, allowedOrigins);
		try {
			const response = await this.options.fetchHtml(fullUrl, {
				timeoutMs:
					scope.timeoutMs ??
					this.options.settings?.timeoutMs ??
					defaultTaskQueueSettings.pageTitleRefresh.timeoutMs,
				maxBytes:
					scope.maxBytes ??
					this.options.settings?.maxBytes ??
					defaultTaskQueueSettings.pageTitleRefresh.maxBytes,
			});
			if (response.status < 200 || response.status >= 300) {
				const error = `http_${response.status}`;
				await this.recordFailure(row, nowIso, response.status, error);
				return { ok: false, error };
			}
			const title = parseHtmlTitle(response.text);
			if (!title) {
				const error = "title_missing";
				await this.recordFailure(row, nowIso, response.status, error);
				return { ok: false, error };
			}
			await this.db
				.update(sitePageRegistry)
				.set({
					title,
					status: successStatus(row.status),
					titleRefreshAttemptedAt: nowIso,
					titleRefreshedAt: nowIso,
					titleRefreshStatusCode: response.status,
					titleRefreshError: null,
					updatedAt: nowIso,
				})
				.where(eq(sitePageRegistry.id, row.id));
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.recordFailure(row, nowIso, null, message);
			return { ok: false, error: message };
		}
	}

	private async recordFailure(
		row: RefreshRow,
		nowIso: string,
		statusCode: number | null,
		error: string,
	) {
		await this.db
			.update(sitePageRegistry)
			.set({
				status: failureStatus(row.status, statusCode),
				titleRefreshAttemptedAt: nowIso,
				titleRefreshStatusCode: statusCode,
				titleRefreshError: error,
				updatedAt: nowIso,
			})
			.where(eq(sitePageRegistry.id, row.id));
	}

	private async listRows(
		scope: PageMetadataRefreshScope,
	): Promise<RefreshRow[]> {
		const site = await this.getSite(scope.siteKey);
		const conditions = [
			eq(sitePageRegistry.siteId, site.id),
			scope.pageKeys?.length
				? inArray(sitePageRegistry.pageKey, scope.pageKeys)
				: undefined,
			scope.onlyMissingTitle && !scope.forceTitle
				? isNull(sitePageRegistry.title)
				: undefined,
		].filter((condition) => condition !== undefined);
		const rows = await this.db
			.select({
				id: sitePageRegistry.id,
				siteKey: sites.siteKey,
				allowedOriginsJson: sites.allowedOriginsJson,
				pageKey: sitePageRegistry.pageKey,
				pageUrl: sitePageRegistry.pageUrl,
				title: sitePageRegistry.title,
				status: sitePageRegistry.status,
			})
			.from(sitePageRegistry)
			.innerJoin(sites, eq(sites.id, sitePageRegistry.siteId))
			.where(and(...conditions));
		return rows;
	}

	private async getSite(siteKey: string) {
		const [site] = await this.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, siteKey))
			.limit(1);
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}
		return site;
	}

	private nowIso() {
		return (this.options.now?.() ?? new Date()).toISOString();
	}
}
