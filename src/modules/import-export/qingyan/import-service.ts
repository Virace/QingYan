import { createHash, randomUUID } from "node:crypto";

import type { SqliteClient } from "../../../db/client";
import type {
	DatabaseBackupResult,
	DatabaseBackupService,
} from "../../database-backup/database-backup-service";
import { secretSystemSettingPaths } from "../../system-settings/definitions";
import {
	InvalidRequestError,
	ResourceNotFoundError,
} from "../../shared/errors";
import {
	hashCommentEmail,
	renderCommentHtml,
} from "../../shared/comment-content";
import {
	parseQingYanExport,
	QINGYAN_EXPORT_FORMAT,
	QINGYAN_EXPORT_FORMAT_VERSION,
	QINGYAN_EXPORT_SOURCE_TYPE,
	qingyanSourceKey,
	type QingYanExport,
	type QingYanExportComment,
	type QingYanExportPageThread,
	type QingYanExportSiteSettings,
	type QingYanExportVisitor,
} from "./export-model";

export type QingYanExistingStrategy = "fail_on_existing" | "skip_existing";
export type QingYanImportMode = "data_only" | "settings_only" | "full_site";
export type QingYanSettingsStrategy = "fail_on_existing" | "replace_settings";

interface ImportBatchRow {
	id: string;
	site_id: number;
	source_type: string;
	summary_json: string;
}

export interface QingYanDryRunResult {
	summary: {
		willCreatePageThreads: number;
		willReusePageThreads: number;
		willCreateVisitors: number;
		willReuseVisitors: number;
		willCreateComments: number;
		willSkipExistingComments: number;
		conflicts: number;
		warnings: number;
	};
	settings: {
		status: "skipped" | "unchanged" | "replace" | "conflict";
		changes: Array<{
			path: string;
			current: unknown;
			incoming: unknown;
			action: "skip" | "replace" | "conflict";
		}>;
	};
	systemSettings: {
		status: "skipped" | "unchanged" | "replace" | "conflict";
		changes: Array<{
			path: string;
			current: unknown;
			incoming: unknown;
			action: "skip" | "replace" | "conflict";
		}>;
	};
	items: Array<{
		type: "page_thread" | "visitor" | "comment";
		status: "create" | "reuse" | "skip" | "conflict" | "warning";
		sourceKey?: string;
		pageKey?: string;
		message: string;
	}>;
}

export interface QingYanApplyResult {
	summary: {
		createdPageThreads: number;
		reusedPageThreads: number;
		createdVisitors: number;
		reusedVisitors: number;
		createdComments: number;
		skippedExistingComments: number;
		createdPageFeedbackRecords: number;
		createdBlacklistRules: number;
		importRecordsCreated: number;
		settingsUpdated: boolean;
		systemSettingsUpdated: boolean;
	};
	dryRun: QingYanDryRunResult;
}

export interface QingYanApplyResponse {
	job: {
		id: string;
		status: "applied";
	};
	apply: QingYanApplyResult;
	backup: DatabaseBackupResult | null;
}

const siteSettingsWritableColumns = [
	"comments_enabled",
	"default_status",
	"max_depth",
	"root_limit",
	"comment_require_json",
	"allow_website",
	"allow_page_like",
	"captcha_mode",
	"captcha_threshold_window_sec",
	"captcha_threshold_max_actions",
	"abuse_guard_enabled",
	"abuse_guard_window_sec",
	"abuse_guard_max_write_actions",
	"auto_blacklist_enabled",
	"auto_blacklist_scope",
	"auto_blacklist_ttl_sec",
	"comment_metadata_json",
	"email_notifications_enabled",
] as const;

function isSecretSystemSetting(row: { category: string; key: string }) {
	return secretSystemSettingPaths.has(`${row.category}.${row.key}`);
}

function hashPayload(payload: unknown) {
	return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function createCommentId() {
	return `c_${randomUUID().replaceAll("-", "")}`;
}

function parsePayload(summaryJson: string) {
	return JSON.parse(summaryJson) as {
		exportPayload: QingYanExport;
		dryRun?: QingYanDryRunResult;
		apply?: QingYanApplyResult;
	};
}

function normalizeSqlValue(value: unknown): unknown {
	if (typeof value === "boolean") {
		return value ? 1 : 0;
	}
	return value;
}

export class QingYanImportService {
	public constructor(
		private readonly sqlite: SqliteClient,
		private readonly backupService?: DatabaseBackupService,
	) {}

	public createDryRun(input: {
		siteKey: string;
		fileName: string;
		payload: unknown;
		existingStrategy: QingYanExistingStrategy;
		importMode?: QingYanImportMode;
		settingsStrategy?: QingYanSettingsStrategy;
	}) {
		const options = this.normalizeOptions(input);
		const exportPayload = this.parseExport(input.payload);
		if (exportPayload.scope.siteKey !== input.siteKey) {
			throw new InvalidRequestError({
				message: "导入文件 siteKey 与目标 siteKey 不一致。",
			});
		}
		const siteId = this.getSiteId(input.siteKey);
		this.assertNoSecretSystemSettings(exportPayload);
		const dryRun = this.buildDryRun(siteId, exportPayload, options);
		const jobId = `qy_${randomUUID().replaceAll("-", "")}`;
		const status =
			dryRun.summary.conflicts > 0 ? "dry_run_failed" : "dry_run_passed";
		this.sqlite
			.prepare(
				`INSERT INTO import_batches (
					id, site_id, source_type, source_file_name, source_hash, format,
					format_version, status, summary_json, options_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				jobId,
				siteId,
				QINGYAN_EXPORT_SOURCE_TYPE,
				input.fileName,
				hashPayload(input.payload),
				QINGYAN_EXPORT_FORMAT,
				QINGYAN_EXPORT_FORMAT_VERSION,
				status,
				JSON.stringify({ exportPayload, dryRun }),
				JSON.stringify(options),
			);

		return {
			job: {
				id: jobId,
				status,
			},
			dryRun,
		};
	}

	public apply(
		jobId: string,
		input: {
			existingStrategy: QingYanExistingStrategy;
			importMode?: QingYanImportMode;
			settingsStrategy?: QingYanSettingsStrategy;
		},
	) {
		return this.sqlite.transaction(() =>
			this.applyInTransaction(jobId, input),
		)();
	}

	public async applyWithBackup(
		jobId: string,
		input: {
			existingStrategy: QingYanExistingStrategy;
			importMode?: QingYanImportMode;
			settingsStrategy?: QingYanSettingsStrategy;
		},
	): Promise<QingYanApplyResponse> {
		const batch = this.getBatch(jobId);
		this.assertCanApply(batch, input);
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
		return {
			...this.sqlite.transaction(() => this.applyInTransaction(jobId, input))(),
			backup,
		};
	}

	private parseExport(payload: unknown) {
		try {
			return parseQingYanExport(payload);
		} catch (error) {
			throw new InvalidRequestError({
				message:
					error instanceof Error
						? `无效 QingYan 导出文件：${error.message}`
						: "无效 QingYan 导出文件。",
			});
		}
	}

	private normalizeOptions(input: {
		existingStrategy: QingYanExistingStrategy;
		importMode?: QingYanImportMode;
		settingsStrategy?: QingYanSettingsStrategy;
	}) {
		return {
			existingStrategy: input.existingStrategy,
			importMode: input.importMode ?? "full_site",
			settingsStrategy: input.settingsStrategy ?? "fail_on_existing",
		};
	}

	private assertNoSecretSystemSettings(payload: QingYanExport) {
		for (const row of payload.data.systemSettings ?? []) {
			if (typeof row.category !== "string" || typeof row.key !== "string") {
				continue;
			}
			if (isSecretSystemSetting({ category: row.category, key: row.key })) {
				throw new InvalidRequestError({
					message: "普通 QingYan 导入不接受 system settings secret 字段。",
				});
			}
		}
	}

	private applyInTransaction(
		jobId: string,
		input: {
			existingStrategy: QingYanExistingStrategy;
			importMode?: QingYanImportMode;
			settingsStrategy?: QingYanSettingsStrategy;
		},
	) {
		const options = this.normalizeOptions(input);
		const batch = this.getBatch(jobId);
		const payload = parsePayload(batch.summary_json);
		const dryRun = this.buildDryRun(
			batch.site_id,
			payload.exportPayload,
			options,
		);
		if (dryRun.summary.conflicts > 0) {
			throw new InvalidRequestError({
				message: "Dry-run 仍存在冲突，不能执行导入。",
			});
		}

		const apply = this.writeExport(
			batch,
			payload.exportPayload,
			dryRun,
			options,
		);
		this.markApplied(
			jobId,
			{
				...payload,
				dryRun,
				apply,
			},
			options,
		);
		return {
			job: {
				id: jobId,
				status: "applied" as const,
			},
			apply,
		};
	}

	private assertCanApply(
		batch: ImportBatchRow,
		input: {
			existingStrategy: QingYanExistingStrategy;
			importMode?: QingYanImportMode;
			settingsStrategy?: QingYanSettingsStrategy;
		},
	) {
		const options = this.normalizeOptions(input);
		const payload = parsePayload(batch.summary_json);
		const dryRun = this.buildDryRun(
			batch.site_id,
			payload.exportPayload,
			options,
		);
		if (dryRun.summary.conflicts > 0) {
			throw new InvalidRequestError({
				message: "Dry-run 仍存在冲突，不能执行导入。",
			});
		}
	}

	private buildDryRun(
		siteId: number,
		payload: QingYanExport,
		options: {
			existingStrategy: QingYanExistingStrategy;
			importMode: QingYanImportMode;
			settingsStrategy: QingYanSettingsStrategy;
		},
	): QingYanDryRunResult {
		const existingSourceKeys = this.existingSourceKeys(siteId, [
			...payload.data.pageThreads.map((item) =>
				qingyanSourceKey("pageThread", item.source.id),
			),
			...payload.data.visitors.map((item) =>
				qingyanSourceKey("visitor", item.source.id),
			),
			...payload.data.comments.map((item) =>
				qingyanSourceKey("comment", item.source.id),
			),
		]);
		const existingPageKeys = this.existingPageKeys(
			siteId,
			payload.data.pageThreads.map((item) => item.pageKey),
		);
		const existingVisitorKeys = this.existingVisitorKeys(
			siteId,
			payload.data.visitors.map((item) => item.visitorKey),
		);
		const summary: QingYanDryRunResult["summary"] = {
			willCreatePageThreads: 0,
			willReusePageThreads: 0,
			willCreateVisitors: 0,
			willReuseVisitors: 0,
			willCreateComments: 0,
			willSkipExistingComments: 0,
			conflicts: 0,
			warnings: 0,
		};
		const items: QingYanDryRunResult["items"] = [];
		const settings = this.buildSettingsDryRun(siteId, payload, options);
		if (settings.status === "conflict") {
			summary.conflicts += 1;
		}
		const systemSettings = this.buildSystemSettingsDryRun(payload, options);
		if (systemSettings.status === "conflict") {
			summary.conflicts += 1;
		}
		if (options.importMode !== "settings_only") {
			for (const thread of payload.data.pageThreads) {
				if (existingPageKeys.has(thread.pageKey)) {
					summary.willReusePageThreads += 1;
					items.push({
						type: "page_thread",
						status: "reuse",
						sourceKey: qingyanSourceKey("pageThread", thread.source.id),
						pageKey: thread.pageKey,
						message: "page thread already exists",
					});
				} else {
					summary.willCreatePageThreads += 1;
					items.push({
						type: "page_thread",
						status: "create",
						sourceKey: qingyanSourceKey("pageThread", thread.source.id),
						pageKey: thread.pageKey,
						message: "page thread will be created",
					});
				}
			}
			for (const visitor of payload.data.visitors) {
				if (existingVisitorKeys.has(visitor.visitorKey)) {
					summary.willReuseVisitors += 1;
					items.push({
						type: "visitor",
						status: "reuse",
						sourceKey: qingyanSourceKey("visitor", visitor.source.id),
						message: "visitor already exists",
					});
				} else {
					summary.willCreateVisitors += 1;
					items.push({
						type: "visitor",
						status: "create",
						sourceKey: qingyanSourceKey("visitor", visitor.source.id),
						message: "visitor will be created",
					});
				}
			}
			for (const comment of payload.data.comments) {
				const sourceKey = qingyanSourceKey("comment", comment.source.id);
				if (existingSourceKeys.has(sourceKey)) {
					if (options.existingStrategy === "skip_existing") {
						summary.willSkipExistingComments += 1;
						items.push({
							type: "comment",
							status: "skip",
							sourceKey,
							pageKey: comment.pageKey,
							message: "source key was already imported",
						});
					} else {
						summary.conflicts += 1;
						items.push({
							type: "comment",
							status: "conflict",
							sourceKey,
							pageKey: comment.pageKey,
							message: "source key was already imported",
						});
					}
					continue;
				}
				summary.willCreateComments += 1;
				items.push({
					type: "comment",
					status: "create",
					sourceKey,
					pageKey: comment.pageKey,
					message: "comment will be created",
				});
			}
		}

		return { summary, settings, systemSettings, items };
	}

	private writeExport(
		batch: ImportBatchRow,
		payload: QingYanExport,
		dryRun: QingYanDryRunResult,
		options: {
			existingStrategy: QingYanExistingStrategy;
			importMode: QingYanImportMode;
			settingsStrategy: QingYanSettingsStrategy;
		},
	): QingYanApplyResult {
		const summary: QingYanApplyResult["summary"] = {
			createdPageThreads: 0,
			reusedPageThreads: 0,
			createdVisitors: 0,
			reusedVisitors: 0,
			createdComments: 0,
			skippedExistingComments: 0,
			createdPageFeedbackRecords: 0,
			createdBlacklistRules: 0,
			importRecordsCreated: 0,
			settingsUpdated: false,
			systemSettingsUpdated: false,
		};
		if (options.importMode !== "data_only") {
			const settingsApply = this.applySettings(batch.site_id, payload, options);
			summary.settingsUpdated = settingsApply.settingsUpdated;
			summary.systemSettingsUpdated = settingsApply.systemSettingsUpdated;
		}
		if (options.importMode === "settings_only") {
			return { summary, dryRun };
		}
		const threadIds = this.ensurePageThreads(
			batch,
			payload.data.pageThreads,
			summary,
		);
		const visitorIds = this.ensureVisitors(
			batch,
			payload.data.visitors,
			summary,
		);
		const oldCommentToNew = new Map<string, string>();
		for (const comment of payload.data.comments) {
			const sourceKey = qingyanSourceKey("comment", comment.source.id);
			const existingTarget = this.existingSourceTarget(
				batch.site_id,
				sourceKey,
			);
			if (existingTarget) {
				oldCommentToNew.set(comment.id, existingTarget);
				summary.skippedExistingComments += 1;
				continue;
			}
			const threadId = threadIds.get(comment.pageKey);
			if (!threadId) {
				throw new InvalidRequestError({
					message: `页面不存在：${comment.pageKey}`,
				});
			}
			const visitorId = comment.visitorKey
				? (visitorIds.get(comment.visitorKey) ?? null)
				: null;
			const parentId = comment.parentId
				? (oldCommentToNew.get(comment.parentId) ?? comment.parentId)
				: null;
			const commentId = this.insertComment(
				batch.site_id,
				threadId,
				visitorId,
				parentId,
				comment,
			);
			this.insertImportRecord(
				batch,
				"comment",
				comment.source.id,
				sourceKey,
				commentId,
				parentId,
			);
			oldCommentToNew.set(comment.id, commentId);
			summary.createdComments += 1;
			summary.importRecordsCreated += 1;
		}
		this.writePageFeedbackRecords(
			batch,
			payload,
			threadIds,
			visitorIds,
			summary,
		);
		this.writeBlacklistRules(batch, payload, summary);

		return { summary, dryRun };
	}

	private ensurePageThreads(
		batch: ImportBatchRow,
		threads: QingYanExportPageThread[],
		summary: QingYanApplyResult["summary"],
	) {
		const map = new Map<string, number>();
		for (const thread of threads) {
			const existing = this.sqlite
				.prepare(
					"SELECT id FROM page_threads WHERE site_id = ? AND page_key = ?",
				)
				.get(batch.site_id, thread.pageKey) as { id: number } | undefined;
			if (existing) {
				map.set(thread.pageKey, existing.id);
				summary.reusedPageThreads += 1;
				continue;
			}
			const result = this.sqlite
				.prepare(
					`INSERT INTO page_threads (
						site_id, page_key, page_title, page_url, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?)`,
				)
				.run(
					batch.site_id,
					thread.pageKey,
					thread.pageTitle,
					thread.pageUrl,
					thread.timestamps?.createdAt ?? new Date().toISOString(),
					thread.timestamps?.updatedAt ?? new Date().toISOString(),
				);
			const id = Number(result.lastInsertRowid);
			map.set(thread.pageKey, id);
			this.insertImportRecord(
				batch,
				"pageThread",
				thread.source.id,
				qingyanSourceKey("pageThread", thread.source.id),
				String(id),
				null,
			);
			summary.createdPageThreads += 1;
			summary.importRecordsCreated += 1;
		}
		return map;
	}

	private ensureVisitors(
		batch: ImportBatchRow,
		visitors: QingYanExportVisitor[],
		summary: QingYanApplyResult["summary"],
	) {
		const map = new Map<string, number>();
		for (const visitor of visitors) {
			const existing = this.sqlite
				.prepare(
					"SELECT id FROM visitors WHERE site_id = ? AND visitor_key = ?",
				)
				.get(batch.site_id, visitor.visitorKey) as { id: number } | undefined;
			if (existing) {
				map.set(visitor.visitorKey, existing.id);
				summary.reusedVisitors += 1;
				continue;
			}
			const result = this.sqlite
				.prepare(
					`INSERT INTO visitors (
						site_id, visitor_key, ip_hash, user_agent_hash, last_seen_at, created_at
					) VALUES (?, ?, ?, ?, ?, ?)`,
				)
				.run(
					batch.site_id,
					visitor.visitorKey,
					visitor.ipHash,
					visitor.userAgentHash,
					visitor.timestamps?.lastSeenAt ?? new Date().toISOString(),
					visitor.timestamps?.createdAt ?? new Date().toISOString(),
				);
			const id = Number(result.lastInsertRowid);
			map.set(visitor.visitorKey, id);
			this.insertImportRecord(
				batch,
				"visitor",
				visitor.source.id,
				qingyanSourceKey("visitor", visitor.source.id),
				String(id),
				null,
			);
			summary.createdVisitors += 1;
			summary.importRecordsCreated += 1;
		}
		return map;
	}

	private insertComment(
		siteId: number,
		threadId: number,
		visitorId: number | null,
		parentId: string | null,
		comment: QingYanExportComment,
	) {
		const commentId = createCommentId();
		const nowIso = new Date().toISOString();
		this.sqlite
			.prepare(
				`INSERT INTO comments (
					id, site_id, page_thread_id, parent_id, visitor_id, status,
					author_name, author_email, author_email_hash, author_website,
					author_ip, author_user_agent, content_raw, content_html,
					created_at, updated_at, deleted_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				commentId,
				siteId,
				threadId,
				parentId,
				visitorId,
				comment.status,
				comment.author.name,
				comment.author.email,
				hashCommentEmail(comment.author.email ?? undefined),
				comment.author.website,
				comment.request?.ip,
				comment.request?.userAgent,
				comment.content.raw,
				comment.content.html ?? renderCommentHtml(comment.content.raw),
				comment.timestamps?.createdAt ?? nowIso,
				comment.timestamps?.updatedAt ?? nowIso,
				comment.timestamps?.deletedAt ?? null,
			);
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
		return commentId;
	}

	private writePageFeedbackRecords(
		batch: ImportBatchRow,
		payload: QingYanExport,
		threadIds: Map<string, number>,
		visitorIds: Map<string, number>,
		summary: QingYanApplyResult["summary"],
	) {
		for (const record of payload.data.pageFeedbackRecords) {
			const source = this.readSource(record);
			const pageKey = this.readString(record, "pageKey");
			const visitorKey = this.readString(record, "visitorKey");
			if (!source || !pageKey || !visitorKey) {
				continue;
			}
			const sourceKey = qingyanSourceKey("pageFeedback", source.id);
			if (this.existingSourceTarget(batch.site_id, sourceKey)) {
				continue;
			}
			const threadId = threadIds.get(pageKey);
			const visitorId = visitorIds.get(visitorKey);
			if (!threadId || !visitorId) {
				continue;
			}
			const result = this.sqlite
				.prepare(
					`INSERT OR IGNORE INTO page_feedback_records (
						page_thread_id, visitor_id, created_at
					) VALUES (?, ?, ?)`,
				)
				.run(threadId, visitorId, this.readCreatedAt(record));
			if (result.changes > 0) {
				const id = String(result.lastInsertRowid);
				this.insertImportRecord(
					batch,
					"pageFeedback",
					source.id,
					sourceKey,
					id,
					null,
				);
				summary.createdPageFeedbackRecords += 1;
				summary.importRecordsCreated += 1;
			}
		}
	}

	private writeBlacklistRules(
		batch: ImportBatchRow,
		payload: QingYanExport,
		summary: QingYanApplyResult["summary"],
	) {
		for (const rule of payload.data.blacklistRules) {
			const source = this.readSource(rule);
			if (!source) {
				continue;
			}
			const sourceKey = qingyanSourceKey("blacklist", source.id);
			if (this.existingSourceTarget(batch.site_id, sourceKey)) {
				continue;
			}
			const result = this.sqlite
				.prepare(
					`INSERT INTO blacklist_rules (
						site_id, scope, target_type, target_value, match_mode,
						reason, source, expires_at, created_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					batch.site_id,
					this.readString(rule, "scope") ?? "post",
					this.readString(rule, "targetType") ??
						this.readString(rule, "target_type") ??
						"email",
					this.readString(rule, "targetValue") ??
						this.readString(rule, "target_value") ??
						"",
					this.readString(rule, "matchMode") ??
						this.readString(rule, "match_mode") ??
						"exact",
					this.readString(rule, "reason"),
					this.readString(rule, "sourceName") ??
						this.readString(rule, "source") ??
						"manual",
					this.readString(rule, "expiresAt") ??
						this.readString(rule, "expires_at"),
					this.readCreatedAt(rule),
				);
			const id = String(result.lastInsertRowid);
			this.insertImportRecord(
				batch,
				"blacklist",
				source.id,
				sourceKey,
				id,
				null,
			);
			summary.createdBlacklistRules += 1;
			summary.importRecordsCreated += 1;
		}
	}

	private buildSettingsDryRun(
		siteId: number,
		payload: QingYanExport,
		options: {
			importMode: QingYanImportMode;
			settingsStrategy: QingYanSettingsStrategy;
		},
	): QingYanDryRunResult["settings"] {
		if (options.importMode === "data_only") {
			return { status: "skipped", changes: [] };
		}

		const changes: QingYanDryRunResult["settings"]["changes"] = [];
		const currentSite = this.sqlite
			.prepare("SELECT name, allowed_origins_json FROM sites WHERE id = ?")
			.get(siteId) as
			| { name: string; allowed_origins_json: string }
			| undefined;
		if (currentSite) {
			const currentAllowedOrigins = JSON.parse(
				currentSite.allowed_origins_json,
			) as string[];
			if (currentSite.name !== payload.data.site.name) {
				changes.push({
					path: "site.name",
					current: currentSite.name,
					incoming: payload.data.site.name,
					action:
						options.settingsStrategy === "replace_settings"
							? "replace"
							: "conflict",
				});
			}
			if (
				JSON.stringify(currentAllowedOrigins) !==
				JSON.stringify(payload.data.site.allowedOrigins)
			) {
				changes.push({
					path: "site.allowedOrigins",
					current: currentAllowedOrigins,
					incoming: payload.data.site.allowedOrigins,
					action:
						options.settingsStrategy === "replace_settings"
							? "replace"
							: "conflict",
				});
			}
		}

		const incomingSettings = payload.data.siteSettings;
		if (incomingSettings) {
			const currentSettings = this.getCurrentSiteSettings(siteId);
			for (const column of siteSettingsWritableColumns) {
				if (!(column in incomingSettings)) {
					continue;
				}
				const current = currentSettings?.[column];
				const incoming = normalizeSqlValue(incomingSettings[column]);
				if (current !== incoming) {
					changes.push({
						path: `siteSettings.${column}`,
						current,
						incoming,
						action:
							options.settingsStrategy === "replace_settings"
								? "replace"
								: "conflict",
					});
				}
			}
		}

		if (changes.length === 0) {
			return { status: "unchanged", changes };
		}

		return {
			status:
				options.settingsStrategy === "replace_settings"
					? "replace"
					: "conflict",
			changes,
		};
	}

	private buildSystemSettingsDryRun(
		payload: QingYanExport,
		options: {
			importMode: QingYanImportMode;
			settingsStrategy: QingYanSettingsStrategy;
		},
	): QingYanDryRunResult["systemSettings"] {
		if (options.importMode === "data_only") {
			return { status: "skipped", changes: [] };
		}

		const changes: QingYanDryRunResult["systemSettings"]["changes"] = [];
		for (const row of this.readSystemSettingRows(payload)) {
			const current = this.getCurrentSystemSettingValue(row.category, row.key);
			if (JSON.stringify(current) === JSON.stringify(row.value)) {
				continue;
			}
			changes.push({
				path: `${row.category}.${row.key}`,
				current,
				incoming: row.value,
				action:
					options.settingsStrategy === "replace_settings"
						? "replace"
						: "conflict",
			});
		}

		if (changes.length === 0) {
			return { status: "unchanged", changes };
		}

		return {
			status:
				options.settingsStrategy === "replace_settings"
					? "replace"
					: "conflict",
			changes,
		};
	}

	private applySettings(
		siteId: number,
		payload: QingYanExport,
		options: {
			settingsStrategy: QingYanSettingsStrategy;
		},
	): { settingsUpdated: boolean; systemSettingsUpdated: boolean } {
		const dryRun = this.buildSettingsDryRun(siteId, payload, {
			importMode: "full_site",
			settingsStrategy: options.settingsStrategy,
		});
		const systemSettingsDryRun = this.buildSystemSettingsDryRun(payload, {
			importMode: "full_site",
			settingsStrategy: options.settingsStrategy,
		});
		if (dryRun.status === "conflict") {
			throw new InvalidRequestError({
				message: "Settings dry-run 存在冲突，不能执行导入。",
			});
		}
		if (systemSettingsDryRun.status === "conflict") {
			throw new InvalidRequestError({
				message: "System settings dry-run 存在冲突，不能执行导入。",
			});
		}

		const settingsUpdated = dryRun.status === "replace";
		if (settingsUpdated) {
			this.sqlite
				.prepare(
					`UPDATE sites
					SET name = ?, allowed_origins_json = ?, updated_at = ?
					WHERE id = ?`,
				)
				.run(
					payload.data.site.name,
					JSON.stringify(payload.data.site.allowedOrigins),
					new Date().toISOString(),
					siteId,
				);
			if (payload.data.siteSettings) {
				this.replaceSiteSettings(siteId, payload.data.siteSettings);
			}
		}

		const systemSettingsUpdated = systemSettingsDryRun.status === "replace";
		if (systemSettingsUpdated) {
			this.replaceSystemSettings(payload);
		}
		return { settingsUpdated, systemSettingsUpdated };
	}

	private replaceSiteSettings(
		siteId: number,
		settings: QingYanExportSiteSettings,
	) {
		const updates = Object.fromEntries(
			siteSettingsWritableColumns
				.filter((column) => column in settings)
				.map((column) => [column, normalizeSqlValue(settings[column])]),
		);
		const columns = Object.keys(updates);
		if (columns.length === 0) {
			return;
		}
		const assignments = columns.map((column) => `${column} = ?`).join(", ");
		this.sqlite
			.prepare(
				`UPDATE site_settings
				SET ${assignments}, updated_at = ?
				WHERE site_id = ?`,
			)
			.run(
				...columns.map((column) => updates[column]),
				new Date().toISOString(),
				siteId,
			);
	}

	private getCurrentSiteSettings(siteId: number) {
		return this.sqlite
			.prepare("SELECT * FROM site_settings WHERE site_id = ?")
			.get(siteId) as Record<string, unknown> | undefined;
	}

	private readSystemSettingRows(payload: QingYanExport) {
		return (payload.data.systemSettings ?? []).map((row) => {
			if (typeof row.category !== "string" || typeof row.key !== "string") {
				throw new InvalidRequestError({
					message: "System setting row 缺少 category 或 key。",
				});
			}
			if (isSecretSystemSetting({ category: row.category, key: row.key })) {
				throw new InvalidRequestError({
					message: "普通 QingYan 导入不接受 system settings secret 字段。",
				});
			}
			const valueJson =
				typeof row.valueJson === "string"
					? row.valueJson
					: typeof row.value_json === "string"
						? row.value_json
						: undefined;
			if (valueJson === undefined) {
				throw new InvalidRequestError({
					message: "System setting row 缺少 value_json。",
				});
			}
			try {
				return {
					category: row.category,
					key: row.key,
					value: JSON.parse(valueJson) as unknown,
				};
			} catch {
				throw new InvalidRequestError({
					message: "System setting row value_json 不是有效 JSON。",
				});
			}
		});
	}

	private getCurrentSystemSettingValue(category: string, key: string) {
		const row = this.sqlite
			.prepare(
				"SELECT value_json FROM system_settings WHERE category = ? AND key = ?",
			)
			.get(category, key) as { value_json: string } | undefined;
		if (!row) {
			return undefined;
		}
		try {
			return JSON.parse(row.value_json) as unknown;
		} catch {
			return undefined;
		}
	}

	private replaceSystemSettings(payload: QingYanExport) {
		const now = new Date().toISOString();
		const statement = this.sqlite.prepare(
			`INSERT INTO system_settings (category, key, value_json, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(category, key)
			DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
		);
		for (const row of this.readSystemSettingRows(payload)) {
			statement.run(row.category, row.key, JSON.stringify(row.value), now);
		}
	}

	private readSource(value: Record<string, unknown>) {
		const source = value.source;
		if (
			source &&
			typeof source === "object" &&
			"id" in source &&
			typeof source.id === "string"
		) {
			return { id: source.id };
		}
		return null;
	}

	private readString(value: Record<string, unknown>, key: string) {
		const item = value[key];
		return typeof item === "string" ? item : null;
	}

	private readCreatedAt(value: Record<string, unknown>) {
		const timestamps = value.timestamps;
		if (
			timestamps &&
			typeof timestamps === "object" &&
			"createdAt" in timestamps &&
			typeof timestamps.createdAt === "string"
		) {
			return timestamps.createdAt;
		}
		const createdAt = this.readString(value, "createdAt");
		return createdAt ?? new Date().toISOString();
	}

	private getBatch(jobId: string) {
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

	private getSiteId(siteKey: string) {
		const site = this.sqlite
			.prepare("SELECT id FROM sites WHERE site_key = ?")
			.get(siteKey) as { id: number } | undefined;
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}
		return site.id;
	}

	private existingSourceKeys(siteId: number, sourceKeys: string[]) {
		if (sourceKeys.length === 0) {
			return new Set<string>();
		}
		const placeholders = sourceKeys.map(() => "?").join(", ");
		const rows = this.sqlite
			.prepare(
				`SELECT source_key FROM import_records
				WHERE site_id = ? AND source_type = ? AND source_key IN (${placeholders})`,
			)
			.all(siteId, QINGYAN_EXPORT_SOURCE_TYPE, ...sourceKeys) as Array<{
			source_key: string;
		}>;
		return new Set(rows.map((row) => row.source_key));
	}

	private existingSourceTarget(siteId: number, sourceKey: string) {
		const row = this.sqlite
			.prepare(
				`SELECT target_id FROM import_records
				WHERE site_id = ? AND source_type = ? AND source_key = ?`,
			)
			.get(siteId, QINGYAN_EXPORT_SOURCE_TYPE, sourceKey) as
			| { target_id: string }
			| undefined;
		return row?.target_id;
	}

	private existingPageKeys(siteId: number, pageKeys: string[]) {
		if (pageKeys.length === 0) {
			return new Set<string>();
		}
		const placeholders = pageKeys.map(() => "?").join(", ");
		const rows = this.sqlite
			.prepare(
				`SELECT page_key FROM page_threads
				WHERE site_id = ? AND page_key IN (${placeholders})`,
			)
			.all(siteId, ...pageKeys) as Array<{ page_key: string }>;
		return new Set(rows.map((row) => row.page_key));
	}

	private existingVisitorKeys(siteId: number, visitorKeys: string[]) {
		if (visitorKeys.length === 0) {
			return new Set<string>();
		}
		const placeholders = visitorKeys.map(() => "?").join(", ");
		const rows = this.sqlite
			.prepare(
				`SELECT visitor_key FROM visitors
				WHERE site_id = ? AND visitor_key IN (${placeholders})`,
			)
			.all(siteId, ...visitorKeys) as Array<{ visitor_key: string }>;
		return new Set(rows.map((row) => row.visitor_key));
	}

	private insertImportRecord(
		batch: ImportBatchRow,
		entityType: string,
		sourceId: string,
		sourceKey: string,
		targetId: string,
		sourceParentKey: string | null,
	) {
		this.sqlite
			.prepare(
				`INSERT OR IGNORE INTO import_records (
					batch_id, site_id, source_type, source_key, source_parent_key,
					target_type, target_id, metadata_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				batch.id,
				batch.site_id,
				QINGYAN_EXPORT_SOURCE_TYPE,
				sourceKey,
				sourceParentKey,
				entityType,
				targetId,
				JSON.stringify({ source: { type: "qingyan", id: sourceId } }),
			);
	}

	private markApplied(
		jobId: string,
		payload: unknown,
		options: { existingStrategy: QingYanExistingStrategy },
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
