import { isIP } from "node:net";

import { and, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import Ip2Region from "ts-ip2region2";

import type { AppDatabase } from "../../../db/client";
import {
	commentRequestMetadata,
	comments,
	ipRegionDatabaseState,
	ipRegionUpdateRuns,
	sites,
} from "../../../db/schema";
import { AppError } from "../../shared/errors";
import type { SystemSettings } from "../../system-settings/definitions";
import type { MaintenanceJobRepository } from "../../ops/maintenance-job-repository";
import { IpRegionUpdater, type IpVersion } from "./ip-region-updater";
import { parseIpRegionText, type IpRegionSnapshot } from "./ip-region";

export type CommentIpRefreshScope = "missing" | "failed" | "stale" | "all";

export interface CommentIpRefreshInput {
	scope: CommentIpRefreshScope;
	ipVersions: IpVersion[];
	siteKey?: string;
	batchSize?: number;
	runAfter?: string | null;
	maxAttempts?: number;
	retryDelaySec?: number;
}

export interface CommentIpMaintenanceOptions {
	resolveIp?: (ip: string, ipVersion: IpVersion) => IpRegionSnapshot;
	loadIpRegionSettings?: () => Promise<SystemSettings["ipRegion"]>;
	updater?: {
		update(input: {
			ipVersion: IpVersion;
			config: SystemSettings["ipRegion"];
			timeoutMs?: number;
		}): Promise<unknown>;
	};
}

function nowIso(): string {
	return new Date().toISOString();
}

function ipVersionSql(ipVersions: IpVersion[]) {
	const wantsV4 = ipVersions.includes("v4");
	const wantsV6 = ipVersions.includes("v6");
	if (wantsV4 && wantsV6) {
		return undefined;
	}
	if (wantsV4) {
		return sql`${commentRequestMetadata.authorIp} NOT LIKE '%:%'`;
	}
	if (wantsV6) {
		return sql`${commentRequestMetadata.authorIp} LIKE '%:%'`;
	}
	return sql`0`;
}

function resolveIpVersion(ip: string): IpVersion {
	return isIP(ip) === 6 ? "v6" : "v4";
}

function hasAuthorIp(row: {
	commentId: string;
	authorIp: string | null;
}): row is { commentId: string; authorIp: string } {
	return Boolean(row.authorIp);
}

export class CommentIpMaintenanceService {
	public constructor(
		private readonly db: AppDatabase,
		private readonly jobs: MaintenanceJobRepository,
		private readonly options: CommentIpMaintenanceOptions = {},
	) {}

	public async getStatus() {
		const states = await this.db.select().from(ipRegionDatabaseState);
		const recentRuns = await this.db
			.select()
			.from(ipRegionUpdateRuns)
			.orderBy(sql`${ipRegionUpdateRuns.createdAt} DESC`)
			.limit(10);
		const [totalWithIp] = await this.db
			.select({ count: sql<number>`COUNT(*)` })
			.from(commentRequestMetadata)
			.where(isNotNull(commentRequestMetadata.authorIp));
		const [missingLocation] = await this.db
			.select({ count: sql<number>`COUNT(*)` })
			.from(commentRequestMetadata)
			.where(
				and(
					isNotNull(commentRequestMetadata.authorIp),
					isNull(commentRequestMetadata.ipLocationUpdatedAt),
				),
			);
		const [failedLocation] = await this.db
			.select({ count: sql<number>`COUNT(*)` })
			.from(commentRequestMetadata)
			.where(
				and(
					isNotNull(commentRequestMetadata.authorIp),
					isNotNull(commentRequestMetadata.ipLocationError),
				),
			);

		return {
			databases: states,
			recentRuns,
			commentMetadata: {
				totalWithIp: totalWithIp?.count ?? 0,
				missingLocation: missingLocation?.count ?? 0,
				failedLocation: failedLocation?.count ?? 0,
			},
			recentJobs: await this.jobs.listRecent(10),
		};
	}

	public async createCommentIpRefreshJob(input: CommentIpRefreshInput) {
		await this.assertNoActiveJob();
		return this.jobs.create({
			type: "comment_ip_refresh",
			scope: {
				scope: input.scope,
				ipVersions: input.ipVersions,
				siteKey: input.siteKey,
				batchSize: input.batchSize ?? 500,
			},
			runAfter: input.runAfter ?? null,
			maxAttempts: input.maxAttempts,
			retryDelaySec: input.retryDelaySec,
		});
	}

	public async createIpRegionUpdateJob(input: {
		ipVersions: IpVersion[];
		timeoutMs?: number;
		runAfter?: string | null;
		maxAttempts?: number;
		retryDelaySec?: number;
	}) {
		await this.assertNoActiveJob();
		return this.jobs.create({
			type: "ip_region_update",
			scope: {
				ipVersions: input.ipVersions,
				timeoutMs: input.timeoutMs,
			},
			runAfter: input.runAfter ?? null,
			maxAttempts: input.maxAttempts,
			retryDelaySec: input.retryDelaySec,
		});
	}

	public async runNextQueuedJob() {
		const active = (await this.jobs.listRunnable({ limit: 20 })).find(
			(job) =>
				job.type === "comment_ip_refresh" || job.type === "ip_region_update",
		);
		if (!active) {
			return null;
		}
		if (active.type === "comment_ip_refresh") {
			return this.runCommentIpRefresh(
				active.id,
				active.scope as CommentIpRefreshInput,
			);
		}
		return this.runIpRegionUpdate(
			active.id,
			active.scope as { ipVersions: IpVersion[]; timeoutMs?: number },
		);
	}

	private async assertNoActiveJob() {
		if (await this.jobs.hasActiveJob()) {
			throw new AppError(
				409,
				"MAINTENANCE_JOB_ALREADY_RUNNING",
				"已有维护任务正在运行。",
			);
		}
	}

	private async runIpRegionUpdate(
		jobId: string,
		scope: { ipVersions: IpVersion[]; timeoutMs?: number },
	) {
		await this.jobs.markRunning(jobId, {
			phase: "updating",
			processed: 0,
		});
		try {
			const settings = await this.loadSettings();
			const updater = this.options.updater ?? new IpRegionUpdater(this.db);
			const results = [];
			for (const ipVersion of scope.ipVersions) {
				results.push({
					ipVersion,
					result: await updater.update({
						ipVersion,
						config: settings,
						timeoutMs: scope.timeoutMs,
					}),
				});
			}
			return this.jobs.markSucceeded(jobId, { results });
		} catch (error) {
			return this.jobs.markFailed(jobId, {
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private async runCommentIpRefresh(
		jobId: string,
		input: CommentIpRefreshInput,
	) {
		await this.jobs.markRunning(jobId, {
			phase: "refreshing",
			processed: 0,
			refreshed: 0,
			failed: 0,
		});
		try {
			const result = await this.refreshCommentIps(jobId, input);
			return this.jobs.markSucceeded(jobId, result);
		} catch (error) {
			return this.jobs.markFailed(jobId, {
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private async refreshCommentIps(jobId: string, input: CommentIpRefreshInput) {
		const states = await this.db.select().from(ipRegionDatabaseState);
		const hashByVersion = new Map(
			states.map((state) => [state.ipVersion as IpVersion, state.fileHash]),
		);
		let processed = 0;
		let refreshed = 0;
		let failed = 0;
		const errors: Array<{ commentId: string; message: string }> = [];
		let afterCommentId: string | null = null;

		for (;;) {
			const rows = await this.listRefreshRows(
				input,
				hashByVersion,
				afterCommentId,
			);
			if (rows.length === 0) {
				break;
			}
			for (const row of rows) {
				processed += 1;
				afterCommentId = row.commentId;
				try {
					const ipVersion = resolveIpVersion(row.authorIp);
					const dbHash = hashByVersion.get(ipVersion);
					if (!dbHash) {
						throw new Error(`missing_${ipVersion}_database`);
					}
					const snapshot = this.options.resolveIp
						? this.options.resolveIp(row.authorIp, ipVersion)
						: await this.resolveWithXdb(row.authorIp, ipVersion);
					await this.updateCommentLocation(
						row.commentId,
						snapshot,
						dbHash,
						null,
					);
					refreshed += 1;
				} catch (error) {
					failed += 1;
					const message =
						error instanceof Error ? error.message : String(error);
					errors.push({ commentId: row.commentId, message });
					await this.updateCommentLocation(row.commentId, null, null, message);
				}
				if (processed % 50 === 0) {
					await this.jobs.updateProgress(jobId, {
						phase: "refreshing",
						processed,
						refreshed,
						failed,
					});
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 0));
		}

		return {
			processed,
			refreshed,
			failed,
			errors: errors.slice(0, 5),
		};
	}

	private async listRefreshRows(
		input: CommentIpRefreshInput,
		hashByVersion: Map<IpVersion, string>,
		afterCommentId: string | null,
	) {
		const filters = [isNotNull(commentRequestMetadata.authorIp)];
		if (afterCommentId) {
			filters.push(gt(commentRequestMetadata.commentId, afterCommentId));
		}
		const versionFilter = ipVersionSql(input.ipVersions);
		if (versionFilter) {
			filters.push(versionFilter);
		}
		if (input.scope === "missing") {
			filters.push(isNull(commentRequestMetadata.ipLocationUpdatedAt));
		}
		if (input.scope === "failed") {
			filters.push(isNotNull(commentRequestMetadata.ipLocationError));
		}
		if (input.scope === "stale") {
			const staleFilters: ReturnType<typeof sql>[] = [];
			if (input.ipVersions.includes("v4") && hashByVersion.get("v4")) {
				staleFilters.push(
					sql`(${commentRequestMetadata.authorIp} NOT LIKE '%:%' AND (${commentRequestMetadata.ipLocationDbHash} IS NULL OR ${commentRequestMetadata.ipLocationDbHash} != ${hashByVersion.get("v4")}))`,
				);
			}
			if (input.ipVersions.includes("v6") && hashByVersion.get("v6")) {
				staleFilters.push(
					sql`(${commentRequestMetadata.authorIp} LIKE '%:%' AND (${commentRequestMetadata.ipLocationDbHash} IS NULL OR ${commentRequestMetadata.ipLocationDbHash} != ${hashByVersion.get("v6")}))`,
				);
			}
			if (staleFilters.length === 1) {
				filters.push(staleFilters[0]);
			}
			if (staleFilters.length > 1) {
				const staleFilter = or(staleFilters[0], staleFilters[1]);
				if (staleFilter) {
					filters.push(staleFilter);
				}
			}
		}

		if (input.siteKey) {
			const rows = await this.db
				.select({
					commentId: commentRequestMetadata.commentId,
					authorIp: commentRequestMetadata.authorIp,
				})
				.from(commentRequestMetadata)
				.innerJoin(comments, eq(comments.id, commentRequestMetadata.commentId))
				.innerJoin(sites, eq(sites.id, comments.siteId))
				.where(and(...filters, eq(sites.siteKey, input.siteKey)))
				.orderBy(commentRequestMetadata.commentId)
				.limit(input.batchSize ?? 500);
			return rows.filter(hasAuthorIp);
		}

		const rows = await this.db
			.select({
				commentId: commentRequestMetadata.commentId,
				authorIp: commentRequestMetadata.authorIp,
			})
			.from(commentRequestMetadata)
			.innerJoin(comments, eq(comments.id, commentRequestMetadata.commentId))
			.innerJoin(sites, eq(sites.id, comments.siteId))
			.where(and(...filters))
			.orderBy(commentRequestMetadata.commentId)
			.limit(input.batchSize ?? 500);
		return rows.filter(hasAuthorIp);
	}

	private async resolveWithXdb(ip: string, ipVersion: IpVersion) {
		const settings = await this.loadSettings();
		const [state] = await this.db
			.select()
			.from(ipRegionDatabaseState)
			.where(eq(ipRegionDatabaseState.ipVersion, ipVersion))
			.limit(1);
		if (!state) {
			throw new Error(`missing_${ipVersion}_database`);
		}
		const searcher = new Ip2Region(state.filePath, {
			ipVersion,
			cachePolicy: settings.cachePolicy,
		});
		try {
			return parseIpRegionText(searcher.search(ip).region);
		} finally {
			searcher.close();
		}
	}

	private async updateCommentLocation(
		commentId: string,
		snapshot: IpRegionSnapshot | null,
		dbHash: string | null,
		error: string | null,
	) {
		const timestamp = nowIso();
		await this.db
			.update(commentRequestMetadata)
			.set({
				ipCountry: snapshot?.country ?? null,
				ipRegion: snapshot?.region ?? null,
				ipCity: snapshot?.city ?? null,
				ipIsp: snapshot?.isp ?? null,
				ipLocationRaw: snapshot?.raw ?? null,
				ipLocationSource: snapshot ? "ip2region" : null,
				ipLocationDbHash: dbHash,
				ipLocationError: error,
				ipLocationUpdatedAt: timestamp,
				updatedAt: timestamp,
			})
			.where(eq(commentRequestMetadata.commentId, commentId));
	}

	private async loadSettings() {
		if (!this.options.loadIpRegionSettings) {
			throw new Error("ip_region_settings_loader_missing");
		}
		return this.options.loadIpRegionSettings();
	}
}
