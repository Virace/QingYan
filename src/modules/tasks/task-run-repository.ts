import { randomUUID } from "node:crypto";

import {
	and,
	count,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	lte,
	ne,
	notInArray,
	or,
	sql,
} from "drizzle-orm";

import type { DatabaseExecutor } from "../../db/client";
import {
	notificationDeliveries,
	scheduledTaskDeletedSnapshots,
	scheduledTasks,
	taskEventLogs,
	taskRuns,
} from "../../db/schema";
import { advisoryLockKey, canonicalJson } from "../../db/values";
import type { ScheduledTaskRecord } from "./scheduled-task-repository";
import { TaskEventLogRepository } from "./task-event-log-repository";
import { taskTextSearch } from "./task-list-query";
import {
	type NotificationDeliveryRecord,
	parseNullableJson,
	stringifyJson,
	type TaskActorType,
	type TaskClaimOptions,
	type TaskQueueBackend,
	type TaskQueuePayload,
	type TaskRunCategory,
	type TaskRunRecord,
	type TaskRunStatus,
} from "./types";

function nowIso(): string {
	return new Date().toISOString();
}

function createTaskRunId() {
	return `task_${randomUUID().replaceAll("-", "")}`;
}

function createNotificationDeliveryId() {
	return `delivery_${randomUUID().replaceAll("-", "")}`;
}

function serializeTaskRun(row: typeof taskRuns.$inferSelect): TaskRunRecord {
	return {
		id: row.id,
		queueBackend: row.queueBackend as TaskQueueBackend,
		queueMessageId: row.queueMessageId,
		scheduledTaskId: row.scheduledTaskId,
		scheduledTaskNameSnapshot: row.scheduledTaskNameSnapshot,
		type: row.type,
		category: row.category as TaskRunCategory,
		status: row.status as TaskRunStatus,
		siteId: row.siteId,
		siteKey: row.siteKey,
		scopeKind: row.scopeKind,
		scope: parseNullableJson(row.scopeJson),
		trigger: row.trigger,
		triggerSnapshot: parseNullableJson(row.triggerSnapshotJson),
		input: parseNullableJson(row.inputJson),
		actionConfigSnapshot: parseNullableJson(row.actionConfigSnapshotJson),
		actorType: row.actorType as TaskActorType | null,
		actorId: row.actorId,
		subjectType: row.subjectType,
		subjectId: row.subjectId,
		payloadSummary: JSON.parse(row.payloadSummaryJson) as unknown,
		payload: JSON.parse(row.payloadJson) as unknown,
		progress: parseNullableJson(row.progressJson),
		result: parseNullableJson(row.resultJson),
		error: parseNullableJson(row.errorJson),
		idempotencyKey: row.idempotencyKey,
		runAfter: row.runAfter,
		attempts: row.attempts,
		maxAttempts: row.maxAttempts,
		retryDelaySec: row.retryDelaySec,
		priority: row.priority,
		concurrencyKey: row.concurrencyKey,
		workerId: row.workerId,
		claimToken: row.claimToken,
		lockConflictWithRunId: row.lockConflictWithRunId,
		lockConflictWithTaskName: row.lockConflictWithTaskName,
		ownerUserIdSnapshot: row.ownerUserIdSnapshot,
		createdByUserId: row.createdByUserId,
		skipReason: row.skipReason,
		blockReason: row.blockReason,
		createdAt: row.createdAt,
		startedAt: row.startedAt,
		finishedAt: row.finishedAt,
		updatedAt: row.updatedAt,
	};
}

function serializeDelivery(
	row: typeof notificationDeliveries.$inferSelect,
): NotificationDeliveryRecord {
	return {
		id: row.id,
		taskRunId: row.taskRunId,
		channel: row.channel,
		channelConfigRef: row.channelConfigRef,
		channelConfigNameSnapshot: row.channelConfigNameSnapshot,
		recipientType:
			row.recipientType as NotificationDeliveryRecord["recipientType"],
		recipientUserId: row.recipientUserId,
		recipientAddressSnapshot: row.recipientAddressSnapshot,
		recipientIdentityKey: row.recipientIdentityKey,
		eventFamily: row.eventFamily,
		templateKey: row.templateKey,
		status: row.status,
		providerMessageId: row.providerMessageId,
		lastError: parseNullableJson(row.lastErrorJson),
		sentAt: row.sentAt,
		updatedAt: row.updatedAt,
	};
}

function readSiteKey(...values: unknown[]): string | null {
	for (const value of values) {
		if (value && typeof value === "object" && "siteKey" in value) {
			const siteKey = (value as { siteKey?: unknown }).siteKey;
			if (typeof siteKey === "string" && siteKey.trim()) {
				return siteKey;
			}
		}
	}
	return null;
}

export class TaskRunRepository {
	public constructor(private readonly db: DatabaseExecutor) {}

	public async create(
		input: TaskQueuePayload & {
			id?: string;
			queueBackend?: TaskQueueBackend;
			status?: TaskRunStatus;
			progress?: unknown;
			result?: unknown;
			error?: unknown;
			attempts?: number;
			input?: unknown;
			trigger?: string | null;
			triggerSnapshot?: unknown;
			scopeKind?: string | null;
			scope?: unknown;
			retryDelaySec?: number;
			priority?: number;
			concurrencyKey?: string | null;
			ownerUserIdSnapshot?: number | null;
			createdByUserId?: number | null;
			startedAt?: string | null;
			finishedAt?: string | null;
			createdAt?: string;
			updatedAt?: string;
		},
	) {
		const timestamp = input.createdAt ?? nowIso();
		const updatedAt = input.updatedAt ?? timestamp;
		const runAfter = input.runAfter ?? null;
		const status: TaskRunStatus =
			input.status ?? (runAfter && runAfter > timestamp ? "delayed" : "queued");
		const id = input.id ?? createTaskRunId();
		const [created] = await this.db
			.insert(taskRuns)
			.values({
				id,
				queueBackend: input.queueBackend ?? "database",
				queueMessageId: input.queueMessageId ?? null,
				scheduledTaskId: null,
				scheduledTaskNameSnapshot: null,
				type: input.type,
				category: input.category,
				status,
				siteId: input.siteId ?? null,
				siteKey: input.siteKey ?? null,
				scopeKind: input.scopeKind ?? null,
				trigger: input.trigger ?? null,
				triggerSnapshotJson:
					input.triggerSnapshot === undefined
						? null
						: stringifyJson(input.triggerSnapshot),
				scopeJson:
					input.scope === undefined ? null : stringifyJson(input.scope),
				inputJson:
					input.input === undefined ? null : stringifyJson(input.input),
				actionConfigSnapshotJson: null,
				actorType: input.actorType ?? null,
				actorId: input.actorId ?? null,
				subjectType: input.subjectType ?? null,
				subjectId: input.subjectId ?? null,
				payloadSummaryJson: stringifyJson(input.payloadSummary ?? {}),
				payloadJson: stringifyJson(input.payload),
				progressJson:
					input.progress === undefined ? null : stringifyJson(input.progress),
				resultJson:
					input.result === undefined ? null : stringifyJson(input.result),
				errorJson:
					input.error === undefined ? null : stringifyJson(input.error),
				idempotencyKey: input.idempotencyKey ?? null,
				runAfter,
				attempts: input.attempts ?? 0,
				maxAttempts: input.maxAttempts ?? 1,
				retryDelaySec: input.retryDelaySec ?? 0,
				priority: input.priority ?? 0,
				concurrencyKey: input.concurrencyKey ?? null,
				workerId: null,
				lockConflictWithRunId: null,
				lockConflictWithTaskName: null,
				ownerUserIdSnapshot: input.ownerUserIdSnapshot ?? null,
				createdByUserId: input.createdByUserId ?? null,
				skipReason: null,
				blockReason: null,
				createdAt: timestamp,
				startedAt: input.startedAt ?? null,
				finishedAt: input.finishedAt ?? null,
				updatedAt,
			})
			.onConflictDoNothing({ target: taskRuns.idempotencyKey })
			.returning();
		if (created) return serializeTaskRun(created);
		if (input.idempotencyKey) {
			const existing = await this.getByIdempotencyKey(input.idempotencyKey);
			if (existing) return existing;
		}
		throw new Error("Task creation did not return a row.");
	}

	public async createScheduledTaskRun(
		input: Parameters<TaskRunRepository["insertScheduledTaskRun"]>[0],
	) {
		const policy = input.scheduledTask.policy as {
			concurrencyKey?: string;
		} | null;
		const concurrencyKey =
			input.concurrencyKey ??
			policy?.concurrencyKey ??
			`task:${input.scheduledTask.type}:${input.scheduledTask.scopeKind}:${canonicalJson(input.scheduledTask.scope)}`;
		return this.db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(${advisoryLockKey("task-concurrency", concurrencyKey)}::bigint)`,
			);
			const repository = new TaskRunRepository(tx);
			const blocking =
				await repository.findRunningByConcurrencyKey(concurrencyKey);
			if (blocking && !input.status) {
				const run = await repository.recordLockConflict({
					...input,
					concurrencyKey,
					conflictWithRunId: blocking.id,
					conflictWithTaskName:
						blocking.scheduledTaskNameSnapshot ?? blocking.type,
				});
				await new TaskEventLogRepository(tx).append({
					taskRunId: run.id,
					eventType: "lock_conflict",
					level: "warn",
					message: "任务运行与正在执行的任务互斥。",
					data: { conflictWithRunId: blocking.id, concurrencyKey },
					visibleToSiteAdmin: true,
				});
				return run;
			}
			return repository.insertScheduledTaskRun({ ...input, concurrencyKey });
		});
	}

	public async createScheduledTaskRunAndAdvance(
		input: Parameters<TaskRunRepository["insertScheduledTaskRun"]>[0],
		advance: {
			nextRunAt: string | null;
			enabled?: boolean;
			disabledReason?: string | null;
		},
	) {
		const policy = input.scheduledTask.policy as {
			concurrencyKey?: string;
		} | null;
		const key =
			input.concurrencyKey ??
			policy?.concurrencyKey ??
			`task:${input.scheduledTask.type}:${input.scheduledTask.scopeKind}:${canonicalJson(input.scheduledTask.scope)}`;
		return this.db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(${advisoryLockKey("task-concurrency", key)}::bigint)`,
			);
			const [scheduled] = await tx
				.select()
				.from(scheduledTasks)
				.where(eq(scheduledTasks.id, input.scheduledTask.id))
				.for("update");
			if (
				!scheduled ||
				scheduled.claimWorkerId !== input.scheduledTask.claimWorkerId ||
				scheduled.claimExpiresAt !== input.scheduledTask.claimExpiresAt
			)
				return null;
			const run = await new TaskRunRepository(tx).createScheduledTaskRun({
				...input,
				concurrencyKey: key,
			});
			await tx
				.update(scheduledTasks)
				.set({
					...advance,
					lastRunAt: run.createdAt,
					lastRunId: run.id,
					lastStatus: run.status,
					claimWorkerId: null,
					claimExpiresAt: null,
					updatedAt: run.createdAt,
				})
				.where(eq(scheduledTasks.id, scheduled.id));
			return run;
		});
	}

	private async insertScheduledTaskRun(input: {
		id?: string;
		scheduledTask: ScheduledTaskRecord;
		trigger: string;
		triggerSnapshot: unknown;
		input: unknown;
		category?: TaskRunCategory;
		createdByUserId?: number | null;
		queueBackend?: TaskQueueBackend;
		status?: TaskRunStatus;
		runAfter?: string | null;
		createdAt?: string;
		updatedAt?: string;
		concurrencyKey?: string | null;
	}) {
		const timestamp = input.createdAt ?? nowIso();
		const runAfter = input.runAfter ?? null;
		const status: TaskRunStatus =
			input.status ?? (runAfter && runAfter > timestamp ? "delayed" : "queued");
		const id = input.id ?? createTaskRunId();
		const policy = (input.scheduledTask.policy ?? {}) as Partial<{
			maxAttempts: number;
			retryDelaySec: number;
			priority: number;
			concurrencyKey: string;
		}>;
		const [created] = await this.db
			.insert(taskRuns)
			.values({
				id,
				queueBackend: input.queueBackend ?? "database",
				queueMessageId: null,
				scheduledTaskId: input.scheduledTask.id,
				scheduledTaskNameSnapshot: input.scheduledTask.name,
				type: input.scheduledTask.type,
				category: input.category ?? "maintenance",
				status,
				siteId: input.scheduledTask.siteId,
				siteKey: readSiteKey(
					input.scheduledTask.scope,
					input.scheduledTask.payload,
					input.input,
				),
				scopeKind: input.scheduledTask.scopeKind,
				trigger: input.trigger,
				triggerSnapshotJson: stringifyJson(input.triggerSnapshot),
				scopeJson: stringifyJson(input.scheduledTask.scope),
				inputJson: stringifyJson(input.input),
				actionConfigSnapshotJson: stringifyJson({
					payload: input.scheduledTask.payload,
					policy: input.scheduledTask.policy,
				}),
				actorType: null,
				actorId: null,
				subjectType: "scheduled_task",
				subjectId: input.scheduledTask.id,
				payloadSummaryJson: stringifyJson({
					scheduledTaskId: input.scheduledTask.id,
					scheduledTaskName: input.scheduledTask.name,
					type: input.scheduledTask.type,
				}),
				payloadJson: stringifyJson(input.input),
				progressJson: null,
				resultJson: null,
				errorJson: null,
				skipReason: null,
				blockReason: null,
				idempotencyKey: null,
				runAfter,
				attempts: 0,
				maxAttempts: policy.maxAttempts ?? 1,
				retryDelaySec: policy.retryDelaySec ?? 0,
				priority: policy.priority ?? 0,
				concurrencyKey: input.concurrencyKey ?? policy.concurrencyKey ?? null,
				workerId: null,
				lockConflictWithRunId: null,
				lockConflictWithTaskName: null,
				ownerUserIdSnapshot: input.scheduledTask.ownerUserId,
				createdByUserId: input.createdByUserId ?? null,
				createdAt: timestamp,
				startedAt: null,
				finishedAt: null,
				updatedAt: input.updatedAt ?? timestamp,
			})
			.returning();
		return serializeTaskRun(created);
	}

	public async createNotificationTaskWithDelivery(input: {
		task: Omit<TaskQueuePayload, "category"> & {
			id?: string;
			queueBackend?: TaskQueueBackend;
			category?: "notification";
			createdAt?: string;
		};
		delivery: Omit<
			Parameters<TaskRunRepository["createNotificationDelivery"]>[0],
			"taskRunId"
		>;
	}) {
		return this.db.transaction(async (tx) => {
			const repository = new TaskRunRepository(tx);
			const task = await repository.create({
				...input.task,
				category: "notification",
			});
			await tx
				.select({ id: taskRuns.id })
				.from(taskRuns)
				.where(eq(taskRuns.id, task.id))
				.for("update");
			const [existing] = await repository.listDeliveriesForTask(task.id);
			if (existing) return { created: false, task, delivery: existing };
			const delivery = await repository.createNotificationDelivery({
				...input.delivery,
				taskRunId: task.id,
			});
			await new TaskEventLogRepository(tx).append({
				taskRunId: task.id,
				eventType:
					input.delivery.channel === "email"
						? "notification.email.queued"
						: "notification.delivery.queued",
				level: "info",
				message: "已创建通知投递并进入队列。",
				data: { channel: input.delivery.channel },
				visibleToSiteAdmin: true,
				createdAt: input.task.createdAt,
			});
			return { created: true, task, delivery };
		});
	}

	public async get(id: string) {
		const [row] = await this.db
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.id, id))
			.limit(1);
		return row ? serializeTaskRun(row) : null;
	}

	public async getRequired(id: string) {
		const task = await this.get(id);
		if (!task) {
			throw new Error(`Task run not found: ${id}`);
		}
		return task;
	}

	public async getByIdempotencyKey(idempotencyKey: string) {
		const [row] = await this.db
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.idempotencyKey, idempotencyKey))
			.limit(1);
		return row ? serializeTaskRun(row) : null;
	}

	public async listByIds(ids: string[]) {
		if (ids.length === 0) {
			return [];
		}
		const rows = await this.db
			.select()
			.from(taskRuns)
			.where(inArray(taskRuns.id, ids));
		const byId = new Map(rows.map((row) => [row.id, serializeTaskRun(row)]));
		return ids.flatMap((id) => {
			const task = byId.get(id);
			return task ? [task] : [];
		});
	}

	public async listNotificationRunsBySubjects(input: {
		subjectType: string;
		subjectIds: string[];
	}) {
		if (input.subjectIds.length === 0) {
			return [];
		}
		const rows = await this.db
			.select()
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.category, "notification"),
					eq(taskRuns.subjectType, input.subjectType),
					inArray(taskRuns.subjectId, input.subjectIds),
				),
			)
			.orderBy(taskRuns.createdAt);
		return rows.map(serializeTaskRun);
	}

	public async listForTaskCenter(input: {
		siteKey?: string;
		type?: string;
		category?: TaskRunCategory;
		status?: TaskRunStatus;
		subjectType?: string;
		subjectId?: string;
		allowedSiteIds?: number[];
		scopeKind?: "global" | "site";
		search?: string;
		searchTypes?: string[];
		safeNotificationSearch?: boolean;
		limit: number;
		offset: number;
	}) {
		const notificationWorkflow = sql`case
			when ${taskRuns.payloadSummaryJson} ->> 'flow' = 'commenter_reply' or ${taskRuns.type} = 'reply_approved' then '评论者回复提醒'
			when ${taskRuns.payloadSummaryJson} ->> 'flow' = 'site_staff_comment' or starts_with(${taskRuns.type}, 'backend_user_comment') then '站点人员评论提醒'
			else '邮件通知' end`;
		const runSearch = or(
			taskTextSearch(input.search, [
				taskRuns.scheduledTaskNameSnapshot,
				taskRuns.type,
				taskRuns.skipReason,
				taskRuns.blockReason,
			]),
			input.searchTypes?.length
				? inArray(taskRuns.type, input.searchTypes)
				: undefined,
		);
		const whereCondition = and(
			input.siteKey ? eq(taskRuns.siteKey, input.siteKey) : undefined,
			input.type ? eq(taskRuns.type, input.type) : undefined,
			input.category ? eq(taskRuns.category, input.category) : undefined,
			input.status ? eq(taskRuns.status, input.status) : undefined,
			input.subjectType
				? eq(taskRuns.subjectType, input.subjectType)
				: undefined,
			input.subjectId ? eq(taskRuns.subjectId, input.subjectId) : undefined,
			input.allowedSiteIds
				? inArray(taskRuns.siteId, input.allowedSiteIds)
				: undefined,
			input.scopeKind === "global"
				? isNull(taskRuns.siteKey)
				: input.scopeKind === "site"
					? isNotNull(taskRuns.siteKey)
					: undefined,
			input.search?.trim()
				? input.safeNotificationSearch
					? or(
							and(ne(taskRuns.category, "notification"), runSearch),
							and(
								eq(taskRuns.category, "notification"),
								taskTextSearch(input.search, [
									notificationWorkflow,
									sql`'邮件通知'`,
									sql`'评论通知'`,
								]),
							),
						)
					: runSearch
				: undefined,
		);
		const rows = await this.db
			.select()
			.from(taskRuns)
			.where(whereCondition)
			.orderBy(desc(taskRuns.createdAt), desc(taskRuns.id))
			.limit(input.limit)
			.offset(input.offset);
		const [total] = await this.db
			.select({ value: count() })
			.from(taskRuns)
			.where(whereCondition);
		return {
			items: rows.map(serializeTaskRun),
			totalCount: Number(total?.value ?? 0),
		};
	}

	public async finalizeScheduledTaskRun(id: string) {
		const completed = await this.get(id);
		const task =
			completed?.subjectType === "task_run" && completed.subjectId
				? await this.get(completed.subjectId)
				: completed;
		const scheduledTaskId = task?.scheduledTaskId;
		if (
			!scheduledTaskId ||
			!task ||
			["queued", "delayed", "running", "retrying"].includes(task.status)
		)
			return;
		await this.db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(${advisoryLockKey("task-retention", scheduledTaskId)}::bigint)`,
			);
			const [current] = await tx
				.select()
				.from(taskRuns)
				.where(eq(taskRuns.id, task.id))
				.for("update");
			if (
				!current ||
				["queued", "delayed", "running", "retrying"].includes(current.status)
			)
				return;
			const [scheduled] = await tx
				.select()
				.from(scheduledTasks)
				.where(eq(scheduledTasks.id, scheduledTaskId))
				.for("update");
			if (!scheduled) return;
			await tx
				.update(scheduledTasks)
				.set({ lastStatus: current.status, updatedAt: nowIso() })
				.where(
					and(
						eq(scheduledTasks.id, scheduled.id),
						eq(scheduledTasks.lastRunId, task.id),
					),
				);
			await new TaskRunRepository(tx).pruneScheduledTaskRuns({
				scheduledTaskId: scheduled.id,
				retainCount: scheduled.retentionCount,
			});
		});
	}

	public async pruneScheduledTaskRuns(input: {
		scheduledTaskId: string;
		retainCount: number;
	}) {
		return this.db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(${advisoryLockKey("task-retention", input.scheduledTaskId)}::bigint)`,
			);
			const rows = await tx
				.select({ id: taskRuns.id })
				.from(taskRuns)
				.where(
					and(
						eq(taskRuns.scheduledTaskId, input.scheduledTaskId),
						inArray(taskRuns.status, [
							"succeeded",
							"failed",
							"skipped",
							"blocked",
							"suppressed",
							"cancelled",
						]),
					),
				)
				.orderBy(desc(taskRuns.createdAt), desc(taskRuns.id))
				.for("update");
			const candidateIds = rows
				.slice(Math.max(0, input.retainCount))
				.map((row) => row.id);
			if (!candidateIds.length) return { deletedRunIds: [] };
			const candidates = await tx
				.select({ id: taskRuns.id })
				.from(taskRuns)
				.where(
					and(
						inArray(taskRuns.id, candidateIds),
						sql`
				not exists (select 1 from ${scheduledTasks} where ${scheduledTasks.lastRunId} = ${taskRuns.id})
				and not exists (select 1 from ${scheduledTaskDeletedSnapshots} where ${scheduledTaskDeletedSnapshots.lastRunId} = ${taskRuns.id} or ${scheduledTaskDeletedSnapshots.snapshotJson} ->> 'lastRunId' = ${taskRuns.id})
				and (
					${taskRuns.status} <> 'failed'
					or (${taskRuns.actionConfigSnapshotJson} -> 'policy' -> 'failureNotification' ->> 'enabled') is distinct from 'true'
					or exists (
						select 1 from ${taskEventLogs} planning
						where planning.task_run_id = ${taskRuns.id}
						and planning.event_type in ('task_failure_notification_enqueued', 'task_failure_notification_failed')
						and planning.data_json -> 'attempt' = jsonb_build_object('claimToken', ${taskRuns.claimToken}::text, 'attempts', ${taskRuns.attempts})
					)
				)
				and not exists (select 1 from task_runs r where r.status in ('queued', 'delayed', 'running', 'retrying') and ((r.subject_type = 'task_run' and r.subject_id = ${taskRuns.id}) or r.lock_conflict_with_run_id = ${taskRuns.id}))`,
					),
				);
			const deleteIds = candidates.map((row) => row.id);

			if (deleteIds.length) {
				await tx
					.delete(notificationDeliveries)
					.where(inArray(notificationDeliveries.taskRunId, deleteIds));
				await tx
					.delete(taskEventLogs)
					.where(inArray(taskEventLogs.taskRunId, deleteIds));
				await tx.delete(taskRuns).where(inArray(taskRuns.id, deleteIds));
			}
			return { deletedRunIds: deleteIds };
		});
	}

	public async findRunningByConcurrencyKey(concurrencyKey: string) {
		const [row] = await this.db
			.select()
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.concurrencyKey, concurrencyKey),
					inArray(taskRuns.status, ["running", "retrying"]),
				),
			)
			.orderBy(desc(taskRuns.createdAt))
			.limit(1);
		return row ? serializeTaskRun(row) : null;
	}

	public async listStaleRunning(staleBeforeIso: string) {
		const rows = await this.db
			.select()
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.status, "running"),
					isNotNull(taskRuns.updatedAt),
					lte(taskRuns.updatedAt, staleBeforeIso),
				),
			)
			.orderBy(taskRuns.updatedAt);
		return rows.map(serializeTaskRun);
	}

	private runnableCondition(input: TaskClaimOptions, timestamp: string) {
		return and(
			eq(taskRuns.queueBackend, "database"),
			inArray(taskRuns.status, ["queued", "delayed", "retrying"]),
			sql`not exists (select 1 from task_runs busy where busy.concurrency_key = ${taskRuns.concurrencyKey} and busy.id <> ${taskRuns.id} and busy.status in ('running', 'retrying'))`,
			or(isNull(taskRuns.runAfter), lte(taskRuns.runAfter, timestamp)),
			input.includeCategories?.length
				? inArray(taskRuns.category, input.includeCategories)
				: undefined,
			input.excludeCategories?.length
				? notInArray(taskRuns.category, input.excludeCategories)
				: undefined,
		);
	}

	public async claimRunnable(input: TaskClaimOptions & { workerId: string }) {
		const timestamp = input.nowIso ?? nowIso();
		const limit = Math.max(1, input.limit ?? 1);
		const candidates = await this.db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(this.runnableCondition(input, timestamp))
			.orderBy(
				desc(taskRuns.priority),
				sql`${taskRuns.runAfter} asc nulls first`,
				taskRuns.createdAt,
				taskRuns.id,
			)
			.limit(Math.max(50, limit * 10));
		const claimed: TaskRunRecord[] = [];
		for (const candidate of candidates) {
			const run = await this.db.transaction(async (tx) => {
				const [row] = await tx
					.select()
					.from(taskRuns)
					.where(
						and(
							eq(taskRuns.id, candidate.id),
							this.runnableCondition(input, timestamp),
						),
					)
					.for("update", { skipLocked: true });
				if (!row) return null;
				if (row.concurrencyKey) {
					// 轮询已锁候选行，只能尝试键锁，避免和先取键锁的入口形成环路。
					const lock = await tx.execute<{ acquired: boolean }>(
						sql`select pg_try_advisory_xact_lock(${advisoryLockKey("task-concurrency", row.concurrencyKey)}::bigint) as acquired`,
					);
					if (
						!lock.rows[0]?.acquired ||
						(await new TaskRunRepository(tx).findBlockingRun(
							row.concurrencyKey,
							row.id,
						))
					)
						return null;
				}
				return new TaskRunRepository(tx).claimLocked(
					row.id,
					input.workerId,
					timestamp,
				);
			});
			if (run) claimed.push(run);
			if (claimed.length >= limit) break;
		}
		return claimed;
	}

	private async findBlockingRun(key: string, excludeId: string) {
		const [row] = await this.db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.concurrencyKey, key),
					sql`${taskRuns.id} <> ${excludeId}`,
					inArray(taskRuns.status, ["running", "retrying"]),
				),
			);
		return row ?? null;
	}

	private async claimLocked(
		id: string,
		workerId: string,
		timestamp: string,
		progress?: unknown,
	) {
		const [row] = await this.db
			.update(taskRuns)
			.set({
				status: "running",
				startedAt: timestamp,
				workerId,
				claimToken: randomUUID(),
				finishedAt: null,
				progressJson: stringifyJson(
					progress ?? { workerId, heartbeatAt: timestamp },
				),
				updatedAt: timestamp,
			})
			.where(eq(taskRuns.id, id))
			.returning();
		return serializeTaskRun(row);
	}

	public async markRunning(
		id: string,
		progress?: unknown,
		timestamp = nowIso(),
	) {
		const snapshot = await this.getRequired(id);
		return this.db.transaction(async (tx) => {
			if (snapshot.concurrencyKey)
				await tx.execute(
					sql`select pg_advisory_xact_lock(${advisoryLockKey("task-concurrency", snapshot.concurrencyKey)}::bigint)`,
				);
			const [row] = await tx
				.select()
				.from(taskRuns)
				.where(and(eq(taskRuns.id, id), this.runnableCondition({}, timestamp)))
				.for("update");
			if (!row) return null;
			const repository = new TaskRunRepository(tx);
			if (
				row.concurrencyKey &&
				(await repository.findBlockingRun(row.concurrencyKey, id))
			)
				return null;
			const workerId =
				progress &&
				typeof progress === "object" &&
				"workerId" in progress &&
				typeof progress.workerId === "string"
					? progress.workerId
					: "task-runner";
			return repository.claimLocked(id, workerId, timestamp, progress);
		});
	}

	public async ownsClaim(id: string, claimToken?: string | null) {
		if (!claimToken) return false;
		const [row] = await this.db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.id, id),
					eq(taskRuns.claimToken, claimToken),
					eq(taskRuns.status, "running"),
				),
			);
		return Boolean(row);
	}

	public async updateProgress(
		id: string,
		progress: unknown,
		claimToken?: string | null,
	) {
		const [row] = await this.db
			.update(taskRuns)
			.set({ progressJson: stringifyJson(progress), updatedAt: nowIso() })
			.where(
				and(
					eq(taskRuns.id, id),
					claimToken
						? and(
								eq(taskRuns.claimToken, claimToken),
								eq(taskRuns.status, "running"),
							)
						: isNull(taskRuns.claimToken),
				),
			)
			.returning();
		return Object.assign(
			row ? serializeTaskRun(row) : await this.getRequired(id),
			{ applied: Boolean(row) },
		);
	}

	private async finish(
		id: string,
		values: Partial<typeof taskRuns.$inferInsert>,
		claimToken?: string | null,
		incrementAttempts = false,
	) {
		return this.db.transaction(async (tx) => {
			const [task] = await tx
				.select()
				.from(taskRuns)
				.where(eq(taskRuns.id, id))
				.for("update");
			if (!task) throw new Error(`Task run not found: ${id}`);
			if (
				claimToken
					? task.claimToken !== claimToken || task.status !== "running"
					: task.claimToken !== null || task.finishedAt !== null
			) {
				return Object.assign(serializeTaskRun(task), { applied: false });
			}
			const [updated] = await tx
				.update(taskRuns)
				.set({
					...values,
					attempts: incrementAttempts ? task.attempts + 1 : task.attempts,
					updatedAt: nowIso(),
				})
				.where(eq(taskRuns.id, id))
				.returning();
			return Object.assign(serializeTaskRun(updated), { applied: true });
		});
	}

	public markSucceeded(
		id: string,
		result: unknown,
		claimToken?: string | null,
	) {
		return this.finish(
			id,
			{
				status: "succeeded",
				resultJson: stringifyJson(result),
				errorJson: null,
				finishedAt: nowIso(),
			},
			claimToken,
		);
	}

	public markFailed(id: string, error: unknown, claimToken?: string | null) {
		return this.finish(
			id,
			{
				status: "failed",
				errorJson: stringifyJson(error),
				finishedAt: nowIso(),
			},
			claimToken,
			true,
		);
	}

	public async markRetrying(
		id: string,
		error: unknown,
		runAfter: string,
		claimToken?: string | null,
	) {
		if (claimToken)
			return this.finish(
				id,
				{
					status: "retrying",
					errorJson: stringifyJson(error),
					runAfter,
					finishedAt: null,
				},
				claimToken,
				true,
			);
		const snapshot = await this.getRequired(id);
		return this.db.transaction(async (tx) => {
			if (snapshot.concurrencyKey)
				await tx.execute(
					sql`select pg_advisory_xact_lock(${advisoryLockKey("task-concurrency", snapshot.concurrencyKey)}::bigint)`,
				);
			const repository = new TaskRunRepository(tx);
			const [task] = await tx
				.select()
				.from(taskRuns)
				.where(eq(taskRuns.id, id))
				.for("update");
			if (!task) throw new Error(`Task run not found: ${id}`);
			if (
				task.concurrencyKey &&
				(await repository.findBlockingRun(task.concurrencyKey, id))
			)
				return Object.assign(serializeTaskRun(task), { applied: false });
			const [row] = await tx
				.update(taskRuns)
				.set({
					status: "retrying",
					claimToken: null,
					workerId: null,
					attempts: task.attempts + 1,
					errorJson: stringifyJson(error),
					runAfter,
					finishedAt: null,
					updatedAt: nowIso(),
				})
				.where(eq(taskRuns.id, id))
				.returning();
			return Object.assign(serializeTaskRun(row), { applied: true });
		});
	}

	public markSuppressed(
		id: string,
		error: unknown,
		claimToken?: string | null,
	) {
		return this.finish(
			id,
			{
				status: "suppressed",
				errorJson: stringifyJson(error),
				finishedAt: nowIso(),
			},
			claimToken,
		);
	}

	public markSkipped(
		id: string,
		skipReason: string,
		result?: unknown,
		claimToken?: string | null,
	) {
		return this.finish(
			id,
			{
				status: "skipped",
				skipReason,
				resultJson: stringifyJson(result),
				finishedAt: nowIso(),
			},
			claimToken,
		);
	}

	public markBlocked(
		id: string,
		blockReason: string,
		error?: unknown,
		claimToken?: string | null,
	) {
		return this.finish(
			id,
			{
				status: "blocked",
				blockReason,
				errorJson: stringifyJson(error),
				finishedAt: nowIso(),
			},
			claimToken,
		);
	}

	public async expireStale(
		run: TaskRunRecord,
		staleBefore: string,
		error: unknown,
	) {
		return this.db.transaction(async (tx) => {
			const timestamp = nowIso();
			const [row] = await tx
				.update(taskRuns)
				.set({
					status: "failed",
					claimToken: null,
					attempts: sql`${taskRuns.attempts} + 1`,
					errorJson: stringifyJson(error),
					finishedAt: timestamp,
					updatedAt: timestamp,
				})
				.where(
					and(
						eq(taskRuns.id, run.id),
						eq(taskRuns.status, "running"),
						lte(taskRuns.updatedAt, staleBefore),
						run.claimToken
							? eq(taskRuns.claimToken, run.claimToken)
							: isNull(taskRuns.claimToken),
					),
				)
				.returning();
			if (!row) return null;
			await new TaskEventLogRepository(tx).append({
				taskRunId: row.id,
				eventType: "stale_run_failed",
				level: "warn",
				message: "任务运行已超过租约期限。",
				data: { staleBefore },
				visibleToSiteAdmin: true,
				createdAt: timestamp,
			});
			return Object.assign(serializeTaskRun(row), { applied: true });
		});
	}

	public async recordLockConflict(input: {
		scheduledTask: ScheduledTaskRecord;
		trigger: string;
		triggerSnapshot: unknown;
		input: unknown;
		category?: TaskRunCategory;
		createdByUserId?: number | null;
		conflictWithRunId: string;
		conflictWithTaskName: string;
		concurrencyKey: string;
	}) {
		const run = await this.insertScheduledTaskRun({
			scheduledTask: input.scheduledTask,
			trigger: input.trigger,
			triggerSnapshot: input.triggerSnapshot,
			input: input.input,
			category: input.category,
			createdByUserId: input.createdByUserId,
			status: "failed",
			concurrencyKey: input.concurrencyKey,
		});
		const timestamp = nowIso();
		await this.db
			.update(taskRuns)
			.set({
				errorJson: stringifyJson({
					code: "TASK_LOCK_CONFLICT",
					conflictWithRunId: input.conflictWithRunId,
					conflictWithTaskName: input.conflictWithTaskName,
				}),
				lockConflictWithRunId: input.conflictWithRunId,
				lockConflictWithTaskName: input.conflictWithTaskName,
				finishedAt: timestamp,
				updatedAt: timestamp,
			})
			.where(eq(taskRuns.id, run.id));
		return this.getRequired(run.id);
	}

	public async cancel(id: string, reason: unknown, claimToken?: string | null) {
		const timestamp = nowIso();
		await this.db
			.update(taskRuns)
			.set({
				status: "cancelled",
				claimToken: null,
				errorJson: stringifyJson(reason),
				finishedAt: timestamp,
				updatedAt: timestamp,
			})
			.where(
				and(
					eq(taskRuns.id, id),
					claimToken
						? and(
								eq(taskRuns.claimToken, claimToken),
								eq(taskRuns.status, "running"),
							)
						: undefined,
				),
			);
		return this.getRequired(id);
	}

	public async cancelIfUnclaimed(id: string, reason: unknown) {
		const timestamp = nowIso();
		await this.db
			.update(taskRuns)
			.set({
				status: "cancelled",
				claimToken: null,
				errorJson: stringifyJson(reason),
				finishedAt: timestamp,
				updatedAt: timestamp,
			})
			.where(
				and(
					eq(taskRuns.id, id),
					inArray(taskRuns.status, ["queued", "delayed", "retrying"]),
				),
			);
		return this.getRequired(id);
	}

	public async createNotificationDelivery(input: {
		taskRunId: string;
		channel: string;
		channelConfigRef?: string | null;
		channelConfigNameSnapshot?: string | null;
		recipientType: NotificationDeliveryRecord["recipientType"];
		recipientUserId?: number | null;
		recipientAddressSnapshot: string;
		recipientIdentityKey: string;
		eventFamily: string;
		templateKey: string;
		status?: string;
	}) {
		const id = createNotificationDeliveryId();
		const timestamp = nowIso();
		await this.db.insert(notificationDeliveries).values({
			id,
			taskRunId: input.taskRunId,
			channel: input.channel,
			channelConfigRef: input.channelConfigRef ?? null,
			channelConfigNameSnapshot: input.channelConfigNameSnapshot ?? null,
			recipientType: input.recipientType,
			recipientUserId: input.recipientUserId ?? null,
			recipientAddressSnapshot: input.recipientAddressSnapshot,
			recipientIdentityKey: input.recipientIdentityKey,
			eventFamily: input.eventFamily,
			templateKey: input.templateKey,
			status: input.status ?? "queued",
			updatedAt: timestamp,
		});
		return this.getDeliveryRequired(id);
	}

	public async listDeliveriesForTask(taskRunId: string) {
		const rows = await this.db
			.select()
			.from(notificationDeliveries)
			.where(eq(notificationDeliveries.taskRunId, taskRunId));
		return rows.map(serializeDelivery);
	}

	public async listDeliveriesForTasks(input: {
		taskRunIds: string[];
		channel?: string;
	}) {
		if (input.taskRunIds.length === 0) {
			return [];
		}
		const rows = await this.db
			.select()
			.from(notificationDeliveries)
			.where(
				and(
					inArray(notificationDeliveries.taskRunId, input.taskRunIds),
					input.channel
						? eq(notificationDeliveries.channel, input.channel)
						: undefined,
				),
			);
		return rows.map(serializeDelivery);
	}

	public async getDeliveryRequired(id: string) {
		const [row] = await this.db
			.select()
			.from(notificationDeliveries)
			.where(eq(notificationDeliveries.id, id))
			.limit(1);
		if (!row) {
			throw new Error(`Notification delivery not found: ${id}`);
		}
		return serializeDelivery(row);
	}

	public async markDeliverySent(input: {
		id: string;
		providerMessageId?: string | null;
		sentAt?: string;
	}) {
		const timestamp = nowIso();
		await this.db
			.update(notificationDeliveries)
			.set({
				status: "sent",
				providerMessageId: input.providerMessageId ?? null,
				sentAt: input.sentAt ?? timestamp,
				lastErrorJson: null,
				updatedAt: timestamp,
			})
			.where(eq(notificationDeliveries.id, input.id));
		return this.getDeliveryRequired(input.id);
	}

	public async markDeliveryFailed(input: {
		id: string;
		error: unknown;
		status?: "failed" | "suppressed";
	}) {
		const timestamp = nowIso();
		await this.db
			.update(notificationDeliveries)
			.set({
				status: input.status ?? "failed",
				lastErrorJson: stringifyJson(input.error),
				updatedAt: timestamp,
			})
			.where(eq(notificationDeliveries.id, input.id));
		return this.getDeliveryRequired(input.id);
	}

	public async completeNotificationAttempt(input: {
		claimToken?: string | null;
		taskId: string;
		outcomes: Array<
			| {
					deliveryId: string;
					status: "sent";
					providerMessageId?: string | null;
					sentAt: string;
			  }
			| {
					deliveryId: string;
					status: "failed";
					error: unknown;
			  }
		>;
		next:
			| { status: "succeeded"; result: unknown }
			| { status: "retrying"; error: unknown; runAfter: string }
			| { status: "failed"; error: unknown };
		events: Array<{
			eventType: string;
			level: "debug" | "info" | "warn" | "error";
			message: string;
			data?: unknown;
		}>;
		updatedAt?: string;
	}) {
		const timestamp = input.updatedAt ?? nowIso();
		return this.db.transaction(async (tx) => {
			const [task] = await tx
				.select()
				.from(taskRuns)
				.where(eq(taskRuns.id, input.taskId))
				.for("update");
			if (!task) throw new Error(`Task run not found: ${input.taskId}`);
			if (
				!input.claimToken ||
				task.claimToken !== input.claimToken ||
				task.status !== "running"
			) {
				return Object.assign(serializeTaskRun(task), { applied: false });
			}
			for (const outcome of [...input.outcomes].sort((left, right) =>
				left.deliveryId < right.deliveryId
					? -1
					: left.deliveryId > right.deliveryId
						? 1
						: 0,
			)) {
				const [delivery] = await tx
					.select()
					.from(notificationDeliveries)
					.where(
						and(
							eq(notificationDeliveries.id, outcome.deliveryId),
							eq(notificationDeliveries.taskRunId, input.taskId),
						),
					)
					.for("update");
				if (!delivery)
					throw new Error(
						`Notification delivery does not belong to task: ${outcome.deliveryId}`,
					);
				if (delivery.status === "sent" && delivery.sentAt) continue;
				await tx
					.update(notificationDeliveries)
					.set(
						outcome.status === "sent"
							? {
									status: "sent",
									providerMessageId: outcome.providerMessageId ?? null,
									sentAt: outcome.sentAt,
									lastErrorJson: null,
									updatedAt: timestamp,
								}
							: {
									status: "failed",
									lastErrorJson: stringifyJson(outcome.error),
									updatedAt: timestamp,
								},
					)
					.where(eq(notificationDeliveries.id, outcome.deliveryId));
			}
			// 父任务锁覆盖事件序号分配和终态；重放保留 claim_token 但不再应用。
			const eventLogs = new TaskEventLogRepository(tx);
			for (const event of input.events)
				await eventLogs.append({
					...event,
					taskRunId: input.taskId,
					claimToken: input.claimToken,
					stream: event.level === "error" ? "stderr" : "system",
					visibleToSiteAdmin: true,
					createdAt: timestamp,
				});
			const [updated] = await tx
				.update(taskRuns)
				.set({
					status: input.next.status,
					attempts: task.attempts + 1,
					resultJson:
						input.next.status === "succeeded"
							? stringifyJson(input.next.result)
							: null,
					errorJson:
						input.next.status === "succeeded"
							? null
							: stringifyJson(input.next.error),
					runAfter:
						input.next.status === "retrying"
							? input.next.runAfter
							: task.runAfter,
					finishedAt: input.next.status === "retrying" ? null : timestamp,
					updatedAt: timestamp,
				})
				.where(eq(taskRuns.id, input.taskId))
				.returning();
			return Object.assign(serializeTaskRun(updated), { applied: true });
		});
	}

	public createDelivery(
		input: Parameters<typeof this.createNotificationDelivery>[0],
	) {
		return this.createNotificationDelivery(input);
	}
}
