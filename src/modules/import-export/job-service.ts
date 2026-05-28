import { createHash, randomUUID } from "node:crypto";

import type { ImportPlan } from "./import-plan";
import type { MigrationReport } from "./report";
import { convertReportToImportPlan } from "./wordpress/convert";
import type { WordPressAnalyzeResult } from "./wordpress/admin-service";
import {
	buildWordPressCommentSourceKey,
	dryRunWordPressImport,
	type ExistingImportStrategy,
	type WordPressDryRunResult,
} from "./wordpress/dry-run";
import type { SqliteClient } from "../../db/client";
import type {
	DatabaseBackupResult,
	DatabaseBackupService,
} from "../database-backup/database-backup-service";
import { InvalidRequestError, ResourceNotFoundError } from "../shared/errors";
import { hashCommentEmail, renderCommentHtml } from "../shared/comment-content";
import type { ImportJobRepository } from "./job-repository";
import type {
	CommentMetadataResolver,
	CommentMetadataSnapshot,
} from "../comments/metadata/resolver";
import { defaultCommentMetadata } from "../shared/site-settings-defaults";
import {
	defaultSystemSettings,
	type SystemSettings,
} from "../system-settings/definitions";

interface ImportJobPayload {
	report?: MigrationReport;
	suggestedMapping?: unknown;
	plan?: ImportPlan;
	dryRun?: WordPressDryRunResult;
	apply?: WordPressApplyResult;
}

interface ImportBatchRow {
	id: string;
	site_id: number;
	source_type: string;
	summary_json: string;
}

interface ThreadRow {
	id: number;
	page_key: string;
}

interface SourceRecordRow {
	source_key: string;
	target_id: string;
}

export interface WordPressApplyResult {
	summary: {
		createdPageThreads: number;
		reusedPageThreads: number;
		createdComments: number;
		skippedExistingComments: number;
		importRecordsCreated: number;
	};
	dryRun: WordPressDryRunResult;
}

export interface WordPressApplyResponse {
	job: {
		id: string;
		status: "applied";
	};
	apply: WordPressApplyResult;
	backup: DatabaseBackupResult | null;
}

function hashText(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

function parsePayload(payload: string): ImportJobPayload {
	return JSON.parse(payload) as ImportJobPayload;
}

function createCommentId() {
	return `c_${randomUUID().replaceAll("-", "")}`;
}

function uniqueValues(values: string[]) {
	return [...new Set(values)];
}

export class ImportJobService {
	public constructor(
		private readonly repository: ImportJobRepository,
		private readonly sqlite: SqliteClient,
		private readonly backupService?: DatabaseBackupService,
		private readonly metadataResolver?: CommentMetadataResolver,
		private readonly loadIpRegionSettings?: () => Promise<
			SystemSettings["ipRegion"]
		>,
	) {}

	public async createWordPressAnalyzeJob(input: {
		siteId: number;
		xml: string;
		result: WordPressAnalyzeResult;
		options: unknown;
	}) {
		const payload: ImportJobPayload = {
			report: input.result.report,
			suggestedMapping: input.result.suggestedMapping,
		};
		await this.repository.createBatch({
			id: input.result.job.id,
			siteId: input.siteId,
			sourceType: "wordpress-wxr",
			sourceFileName: input.result.report.source.fileName,
			sourceHash: hashText(input.xml),
			format: "wordpress-wxr",
			formatVersion: 1,
			status: "analyzed",
			summaryJson: JSON.stringify(payload),
			optionsJson: JSON.stringify(input.options),
		});
	}

	public async convertWordPressJobToPlan(
		jobId: string,
		input?: { authorDecisions?: Record<string, "verified" | "visitor"> },
	) {
		const batch = await this.repository.getBatch(jobId);
		if (!batch) {
			throw new ResourceNotFoundError(
				"IMPORT_JOB_NOT_FOUND",
				"导入任务不存在。",
			);
		}
		const payload = parsePayload(batch.summaryJson);
		if (!payload.report) {
			throw new InvalidRequestError({
				message: "导入任务缺少 WordPress 迁移报告。",
			});
		}

		let plan: ImportPlan;
		try {
			plan = convertReportToImportPlan({
				report: payload.report,
				authorDecisions: input?.authorDecisions,
			});
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.startsWith("Unresolved WordPress author candidates")
			) {
				throw new InvalidRequestError({
					message: error.message,
				});
			}
			throw error;
		}
		const nextPayload: ImportJobPayload = {
			...payload,
			plan,
		};
		await this.repository.updateBatch(jobId, {
			status: "planned",
			summaryJson: JSON.stringify(nextPayload),
		});

		return {
			job: {
				id: jobId,
				status: "planned" as const,
			},
			plan,
		};
	}

	public async dryRun(
		jobId: string,
		input: { existingStrategy: ExistingImportStrategy },
	) {
		const batch = await this.repository.getBatch(jobId);
		if (!batch) {
			throw new ResourceNotFoundError(
				"IMPORT_JOB_NOT_FOUND",
				"导入任务不存在。",
			);
		}
		const payload = parsePayload(batch.summaryJson);
		if (!payload.plan) {
			throw new InvalidRequestError({
				message: "导入任务还没有生成 import plan。",
			});
		}

		const pageKeys = payload.plan.items.map((item) => item.pageKey);
		const sourceKeys = payload.plan.items.flatMap((item) =>
			item.comments.map((comment) => buildWordPressCommentSourceKey(comment)),
		);
		const [existingPageKeys, existingSourceKeys] = await Promise.all([
			this.repository.listExistingPageKeys(batch.siteId, pageKeys),
			this.repository.listExistingSourceKeys(
				batch.siteId,
				batch.sourceType,
				sourceKeys,
			),
		]);
		const dryRun = dryRunWordPressImport({
			plan: payload.plan,
			existingPageKeys,
			existingSourceKeys,
			existingStrategy: input.existingStrategy,
		});
		const status =
			dryRun.summary.conflicts > 0 ? "dry_run_failed" : "dry_run_passed";
		const nextPayload: ImportJobPayload = {
			...payload,
			dryRun,
		};
		await this.repository.updateBatch(jobId, {
			status,
			summaryJson: JSON.stringify(nextPayload),
			optionsJson: JSON.stringify(input),
		});

		return {
			job: {
				id: jobId,
				status,
			},
			dryRun,
		};
	}

	public async apply(
		jobId: string,
		input: { existingStrategy: ExistingImportStrategy },
	): Promise<WordPressApplyResponse> {
		const batch = this.getBatchRow(jobId);
		const payload = parsePayload(batch.summary_json);
		this.assertPlanCanApply(batch, payload, input);
		const backup = this.backupService
			? await this.backupService.createImportBackup({
					jobId,
					siteId: batch.site_id,
					sourceType: batch.source_type,
				})
			: null;
		if (backup) {
			this.updateBackup(jobId, backup);
		}
		try {
			const ipRegionSettings = await this.resolveImportIpRegionSettings();
			const result = this.sqlite.transaction(() =>
				this.applyInTransaction(jobId, input, ipRegionSettings),
			)();
			return {
				...result,
				backup,
			};
		} catch (error) {
			if (error instanceof InvalidRequestError) {
				throw error;
			}
			throw error;
		}
	}

	private assertPlanCanApply(
		batch: ImportBatchRow,
		payload: ImportJobPayload,
		input: { existingStrategy: ExistingImportStrategy },
	) {
		if (!payload.plan) {
			throw new InvalidRequestError({
				message: "导入任务还没有生成 import plan。",
			});
		}
		const sourceKeys = this.listPlanSourceKeys(payload.plan);
		const existingSourceRecords = this.selectSourceRecords(
			batch.site_id,
			batch.source_type,
			sourceKeys,
		);
		const existingPageKeys = this.selectPageThreadKeys(
			batch.site_id,
			payload.plan.items.map((item) => item.pageKey),
		);
		const dryRun = dryRunWordPressImport({
			plan: payload.plan,
			existingPageKeys,
			existingSourceKeys: new Set(existingSourceRecords.keys()),
			existingStrategy: input.existingStrategy,
		});
		if (dryRun.summary.conflicts > 0) {
			throw new InvalidRequestError({
				message: "Dry-run 仍存在冲突，不能执行导入。",
			});
		}
	}

	private applyInTransaction(
		jobId: string,
		input: { existingStrategy: ExistingImportStrategy },
		ipRegionSettings: SystemSettings["ipRegion"],
	) {
		const batch = this.getBatchRow(jobId);
		const payload = parsePayload(batch.summary_json);
		if (!payload.plan) {
			throw new InvalidRequestError({
				message: "导入任务还没有生成 import plan。",
			});
		}

		const sourceKeys = this.listPlanSourceKeys(payload.plan);
		const existingSourceRecords = this.selectSourceRecords(
			batch.site_id,
			batch.source_type,
			sourceKeys,
		);
		const existingPageKeys = this.selectPageThreadKeys(
			batch.site_id,
			payload.plan.items.map((item) => item.pageKey),
		);
		const dryRun = dryRunWordPressImport({
			plan: payload.plan,
			existingPageKeys,
			existingSourceKeys: new Set(existingSourceRecords.keys()),
			existingStrategy: input.existingStrategy,
		});
		if (dryRun.summary.conflicts > 0) {
			throw new InvalidRequestError({
				message: "Dry-run 仍存在冲突，不能执行导入。",
			});
		}

		const apply = this.writePlan(
			batch,
			payload.plan,
			dryRun,
			existingSourceRecords,
			ipRegionSettings,
		);
		this.markApplied(
			batch.id,
			{
				...payload,
				dryRun,
				apply,
			},
			input,
		);

		return {
			job: {
				id: jobId,
				status: "applied" as const,
			},
			apply,
		};
	}

	private getBatchRow(jobId: string) {
		const batch = this.sqlite
			.prepare(
				"SELECT id, site_id, source_type, summary_json FROM import_batches WHERE id = ?",
			)
			.get(jobId) as ImportBatchRow | undefined;
		if (!batch) {
			throw new ResourceNotFoundError(
				"IMPORT_JOB_NOT_FOUND",
				"导入任务不存在。",
			);
		}
		return batch;
	}

	private listPlanSourceKeys(plan: ImportPlan) {
		return plan.items.flatMap((item) =>
			item.comments.map((comment) => buildWordPressCommentSourceKey(comment)),
		);
	}

	private selectPageThreadKeys(siteId: number, pageKeys: string[]) {
		const values = uniqueValues(pageKeys);
		if (values.length === 0) {
			return new Set<string>();
		}
		const placeholders = values.map(() => "?").join(", ");
		const rows = this.sqlite
			.prepare(
				`SELECT page_key FROM page_threads WHERE site_id = ? AND page_key IN (${placeholders})`,
			)
			.all(siteId, ...values) as Array<{ page_key: string }>;
		return new Set(rows.map((row) => row.page_key));
	}

	private selectSourceRecords(
		siteId: number,
		sourceType: string,
		sourceKeys: string[],
	) {
		const values = uniqueValues(sourceKeys);
		const records = new Map<string, string>();
		if (values.length === 0) {
			return records;
		}
		const placeholders = values.map(() => "?").join(", ");
		const rows = this.sqlite
			.prepare(
				`SELECT source_key, target_id FROM import_records WHERE site_id = ? AND source_type = ? AND source_key IN (${placeholders})`,
			)
			.all(siteId, sourceType, ...values) as SourceRecordRow[];
		for (const row of rows) {
			records.set(row.source_key, row.target_id);
		}
		return records;
	}

	private writePlan(
		batch: ImportBatchRow,
		plan: ImportPlan,
		dryRun: WordPressDryRunResult,
		existingSourceRecords: Map<string, string>,
		ipRegionSettings: SystemSettings["ipRegion"],
	): WordPressApplyResult {
		const summary = {
			createdPageThreads: 0,
			reusedPageThreads: 0,
			createdComments: 0,
			skippedExistingComments: 0,
			importRecordsCreated: 0,
		};
		const threads = this.ensurePageThreads(batch.site_id, plan, summary);
		for (const item of plan.items) {
			const threadId = threads.get(item.pageKey);
			if (!threadId) {
				throw new InvalidRequestError({ message: "导入计划缺少页面线程。" });
			}
			this.writeItemComments(
				batch,
				item,
				threadId,
				existingSourceRecords,
				summary,
				ipRegionSettings,
			);
		}
		return { summary, dryRun };
	}

	private ensurePageThreads(
		siteId: number,
		plan: ImportPlan,
		summary: WordPressApplyResult["summary"],
	) {
		const rows = this.selectPageThreads(
			siteId,
			plan.items.map((item) => item.pageKey),
		);
		const threads = new Map(rows.map((row) => [row.page_key, row.id]));
		for (const item of plan.items) {
			if (threads.has(item.pageKey)) {
				summary.reusedPageThreads += 1;
				continue;
			}
			const id = this.insertPageThread(siteId, item);
			threads.set(item.pageKey, id);
			summary.createdPageThreads += 1;
		}
		return threads;
	}

	private selectPageThreads(siteId: number, pageKeys: string[]) {
		const values = uniqueValues(pageKeys);
		if (values.length === 0) {
			return [];
		}
		const placeholders = values.map(() => "?").join(", ");
		return this.sqlite
			.prepare(
				`SELECT id, page_key FROM page_threads WHERE site_id = ? AND page_key IN (${placeholders})`,
			)
			.all(siteId, ...values) as ThreadRow[];
	}

	private insertPageThread(siteId: number, item: ImportPlan["items"][number]) {
		const nowIso = new Date().toISOString();
		const result = this.sqlite
			.prepare(
				`INSERT INTO page_threads (site_id, page_key, page_title, page_url, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(siteId, item.pageKey, item.pageTitle, item.pageUrl, nowIso, nowIso);
		return Number(result.lastInsertRowid);
	}

	private writeItemComments(
		batch: ImportBatchRow,
		item: ImportPlan["items"][number],
		threadId: number,
		existingSourceRecords: Map<string, string>,
		summary: WordPressApplyResult["summary"],
		ipRegionSettings: SystemSettings["ipRegion"],
	) {
		const oldToNew = new Map<string, string>();
		for (const comment of item.comments) {
			const sourceKey = buildWordPressCommentSourceKey(comment);
			const existingTargetId = existingSourceRecords.get(sourceKey);
			if (existingTargetId) {
				oldToNew.set(comment.source.oldCommentId, existingTargetId);
				summary.skippedExistingComments += 1;
				continue;
			}
			const parentId = this.resolveParentId(comment, oldToNew);
			const commentId = this.insertComment(
				batch.site_id,
				threadId,
				parentId,
				comment,
				ipRegionSettings,
			);
			this.insertImportRecord(batch, sourceKey, parentId, commentId, comment);
			oldToNew.set(comment.source.oldCommentId, commentId);
			summary.createdComments += 1;
			summary.importRecordsCreated += 1;
		}
	}

	private resolveParentId(
		comment: ImportPlan["items"][number]["comments"][number],
		oldToNew: Map<string, string>,
	) {
		if (!comment.parentOldCommentId) {
			return null;
		}
		const parentId = oldToNew.get(comment.parentOldCommentId);
		if (!parentId) {
			throw new InvalidRequestError({
				message: `父评论未导入：${comment.parentOldCommentId}`,
			});
		}
		return parentId;
	}

	private insertComment(
		siteId: number,
		threadId: number,
		parentId: string | null,
		comment: ImportPlan["items"][number]["comments"][number],
		ipRegionSettings: SystemSettings["ipRegion"],
	) {
		const nowIso = new Date().toISOString();
		const createdAt = comment.createdAt ?? nowIso;
		const commentId = createCommentId();
		this.sqlite
			.prepare(
				`INSERT INTO comments (
					id, site_id, page_thread_id, parent_id, author_identity, status, author_name,
					author_email, author_email_hash, author_website,
					content_raw, content_html, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				commentId,
				siteId,
				threadId,
				parentId,
				comment.authorIdentity,
				comment.status,
				comment.authorName,
				comment.authorEmail,
				hashCommentEmail(comment.authorEmail),
				comment.authorUrl,
				comment.content,
				renderCommentHtml(comment.content),
				createdAt,
				nowIso,
			);
		const metadata = this.resolveCommentRequestMetadata(
			comment,
			ipRegionSettings,
		);
		if (comment.authorIp || comment.userAgent || metadata) {
			this.sqlite
				.prepare(
					`INSERT INTO comment_request_metadata (
						comment_id, author_ip, author_user_agent,
						ip_country, ip_region, ip_city, ip_isp, ip_location_raw,
						ip_location_source, ip_location_db_hash, ip_location_updated_at,
						ip_location_error, device_browser, device_browser_version,
						device_os, device_os_version, device_type, device_icon,
						device_source, device_parser_version, device_updated_at,
						device_error, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					commentId,
					comment.authorIp,
					comment.userAgent,
					metadata?.authorIpCountry,
					metadata?.authorIpRegion,
					metadata?.authorIpCity,
					metadata?.authorIpIsp,
					metadata?.authorIpLocationRaw,
					metadata?.authorIpLocationSource,
					metadata?.authorIpLocationDbHash,
					metadata?.authorIpLocationUpdatedAt,
					metadata?.authorIpLocationError,
					metadata?.authorDeviceBrowser,
					metadata?.authorDeviceBrowserVersion,
					metadata?.authorDeviceOs,
					metadata?.authorDeviceOsVersion,
					metadata?.authorDeviceType,
					metadata?.authorDeviceIcon,
					metadata?.authorDeviceSource,
					metadata?.authorDeviceParserVersion,
					metadata?.authorDeviceUpdatedAt,
					metadata?.authorDeviceError,
					nowIso,
					nowIso,
				);
		}
		this.updateCommentCounts(threadId, parentId, nowIso);
		return commentId;
	}

	private async resolveImportIpRegionSettings() {
		if (!this.loadIpRegionSettings) {
			return defaultSystemSettings.ipRegion;
		}

		return this.loadIpRegionSettings();
	}

	private resolveCommentRequestMetadata(
		comment: ImportPlan["items"][number]["comments"][number],
		ipRegionSettings: SystemSettings["ipRegion"],
	) {
		if (!this.metadataResolver || (!comment.authorIp && !comment.userAgent)) {
			return undefined;
		}

		const snapshot = this.metadataResolver.resolve({
			ip: comment.authorIp,
			userAgent: comment.userAgent,
			metadata: defaultCommentMetadata,
			ipRegion: ipRegionSettings,
		});
		if (snapshot instanceof Promise) {
			return undefined;
		}

		return snapshot satisfies CommentMetadataSnapshot;
	}

	private updateCommentCounts(
		threadId: number,
		parentId: string | null,
		nowIso: string,
	) {
		if (parentId) {
			this.sqlite
				.prepare(
					"UPDATE comments SET reply_count = reply_count + 1, updated_at = ? WHERE id = ?",
				)
				.run(nowIso, parentId);
		}
		this.sqlite
			.prepare(
				`UPDATE page_threads
				SET comment_count = comment_count + 1,
					root_comment_count = root_comment_count + ?,
					updated_at = ?
				WHERE id = ?`,
			)
			.run(parentId ? 0 : 1, nowIso, threadId);
	}

	private insertImportRecord(
		batch: ImportBatchRow,
		sourceKey: string,
		parentId: string | null,
		commentId: string,
		comment: ImportPlan["items"][number]["comments"][number],
	) {
		this.sqlite
			.prepare(
				`INSERT INTO import_records (
					batch_id, site_id, source_type, source_key, source_parent_key,
					target_type, target_id, metadata_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				batch.id,
				batch.site_id,
				batch.source_type,
				sourceKey,
				parentId
					? `wordpress:post:${comment.source.wpPostId}:comment:${comment.parentOldCommentId}`
					: null,
				"comment",
				commentId,
				JSON.stringify({ source: comment.source }),
			);
	}

	private markApplied(
		jobId: string,
		payload: ImportJobPayload,
		options: { existingStrategy: ExistingImportStrategy },
	) {
		const nowIso = new Date().toISOString();
		this.sqlite
			.prepare(
				`UPDATE import_batches
				SET status = ?, summary_json = ?, options_json = ?, updated_at = ?, applied_at = ?
				WHERE id = ?`,
			)
			.run(
				"applied",
				JSON.stringify(payload),
				JSON.stringify(options),
				nowIso,
				nowIso,
				jobId,
			);
	}

	private updateBackup(jobId: string, backup: DatabaseBackupResult) {
		this.sqlite
			.prepare(
				`UPDATE import_batches
				SET backup_json = ?, updated_at = ?
				WHERE id = ?`,
			)
			.run(JSON.stringify(backup), new Date().toISOString(), jobId);
	}
}
