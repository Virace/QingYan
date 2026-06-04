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
	or,
} from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	notificationDeliveries,
	taskEventLogs,
	taskRuns,
} from "../../db/schema";
import type { ScheduledTaskRecord } from "./scheduled-task-repository";
import {
	type NotificationDeliveryRecord,
	parseNullableJson,
	stringifyJson,
	type TaskActorType,
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
	public constructor(private readonly db: AppDatabase) {}

	public async create(
		input: TaskQueuePayload & {
			id?: string;
			queueBackend?: TaskQueueBackend;
			status?: TaskRunStatus;
			progress?: unknown;
			result?: unknown;
			error?: unknown;
			attempts?: number;
			startedAt?: string | null;
			finishedAt?: string | null;
			createdAt?: string;
			updatedAt?: string;
		},
	) {
		const timestamp = input.createdAt ?? nowIso();
		const updatedAt = input.updatedAt ?? timestamp;
		if (input.idempotencyKey) {
			const existing = await this.getByIdempotencyKey(input.idempotencyKey);
			if (existing) {
				return existing;
			}
		}
		const runAfter = input.runAfter ?? null;
		const status: TaskRunStatus =
			input.status ?? (runAfter && runAfter > timestamp ? "delayed" : "queued");
		const id = input.id ?? createTaskRunId();
		await this.db.insert(taskRuns).values({
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
			scopeKind: null,
			trigger: null,
			triggerSnapshotJson: null,
			scopeJson: null,
			inputJson: null,
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
			errorJson: input.error === undefined ? null : stringifyJson(input.error),
			idempotencyKey: input.idempotencyKey ?? null,
			runAfter,
			attempts: input.attempts ?? 0,
			maxAttempts: input.maxAttempts ?? 1,
			retryDelaySec: 0,
			priority: 0,
			concurrencyKey: null,
			workerId: null,
			lockConflictWithRunId: null,
			lockConflictWithTaskName: null,
			ownerUserIdSnapshot: null,
			createdByUserId: null,
			skipReason: null,
			blockReason: null,
			createdAt: timestamp,
			startedAt: input.startedAt ?? null,
			finishedAt: input.finishedAt ?? null,
			updatedAt,
		});
		return this.getRequired(id);
	}

	public async createScheduledTaskRun(input: {
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
		await this.db.insert(taskRuns).values({
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
		});
		return this.getRequired(id);
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

	public async listForTaskCenter(input: {
		siteKey?: string;
		category?: TaskRunCategory;
		status?: TaskRunStatus;
		limit: number;
		offset: number;
	}) {
		const whereCondition = and(
			input.siteKey ? eq(taskRuns.siteKey, input.siteKey) : undefined,
			input.category ? eq(taskRuns.category, input.category) : undefined,
			input.status ? eq(taskRuns.status, input.status) : undefined,
		);
		const rows = await this.db
			.select()
			.from(taskRuns)
			.where(whereCondition)
			.orderBy(desc(taskRuns.createdAt))
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

	public async pruneScheduledTaskRuns(input: {
		scheduledTaskId: string;
		retainCount: number;
	}) {
		const retainCount = Math.max(0, input.retainCount);
		const rows = await this.db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(eq(taskRuns.scheduledTaskId, input.scheduledTaskId))
			.orderBy(desc(taskRuns.createdAt), desc(taskRuns.id));
		const deleteIds = rows.slice(retainCount).map((row) => row.id);
		if (deleteIds.length === 0) {
			return { deletedRunIds: [] };
		}
		this.db.transaction((tx) => {
			tx.delete(notificationDeliveries)
				.where(inArray(notificationDeliveries.taskRunId, deleteIds))
				.run();
			tx.delete(taskEventLogs)
				.where(inArray(taskEventLogs.taskRunId, deleteIds))
				.run();
			tx.delete(taskRuns).where(inArray(taskRuns.id, deleteIds)).run();
		});
		return { deletedRunIds: deleteIds };
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

	public async claimRunnable(input: {
		workerId: string;
		nowIso?: string;
		limit?: number;
	}) {
		const timestamp = input.nowIso ?? nowIso();
		const runnableCondition = and(
			inArray(taskRuns.status, ["queued", "delayed", "retrying"]),
			or(isNull(taskRuns.runAfter), lte(taskRuns.runAfter, timestamp)),
		);
		const rows = await this.db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(runnableCondition)
			.orderBy(desc(taskRuns.priority), taskRuns.runAfter, taskRuns.createdAt)
			.limit(Math.max(1, input.limit ?? 1));
		const claimed: TaskRunRecord[] = [];
		for (const row of rows) {
			const [updated] = await this.db
				.update(taskRuns)
				.set({
					status: "running",
					startedAt: timestamp,
					workerId: input.workerId,
					progressJson: stringifyJson({
						workerId: input.workerId,
						heartbeatAt: timestamp,
					}),
					updatedAt: timestamp,
				})
				.where(and(eq(taskRuns.id, row.id), runnableCondition))
				.returning();
			if (updated) {
				claimed.push(serializeTaskRun(updated));
			}
		}
		return claimed;
	}

	public async markRunning(id: string, progress?: unknown) {
		const timestamp = nowIso();
		await this.db
			.update(taskRuns)
			.set({
				status: "running",
				startedAt: timestamp,
				workerId:
					progress &&
					typeof progress === "object" &&
					"workerId" in progress &&
					typeof progress.workerId === "string"
						? progress.workerId
						: undefined,
				progressJson:
					progress === undefined ? undefined : stringifyJson(progress),
				updatedAt: timestamp,
			})
			.where(eq(taskRuns.id, id));
		return this.getRequired(id);
	}

	public async updateProgress(id: string, progress: unknown) {
		const timestamp = nowIso();
		await this.db
			.update(taskRuns)
			.set({
				progressJson: stringifyJson(progress),
				updatedAt: timestamp,
			})
			.where(eq(taskRuns.id, id));
		return this.getRequired(id);
	}

	public async markSucceeded(id: string, result: unknown) {
		const timestamp = nowIso();
		await this.db
			.update(taskRuns)
			.set({
				status: "succeeded",
				resultJson: stringifyJson(result),
				finishedAt: timestamp,
				updatedAt: timestamp,
			})
			.where(eq(taskRuns.id, id));
		return this.getRequired(id);
	}

	public async markFailed(id: string, error: unknown) {
		const timestamp = nowIso();
		const task = await this.getRequired(id);
		await this.db
			.update(taskRuns)
			.set({
				status: "failed",
				attempts: task.attempts + 1,
				errorJson: stringifyJson(error),
				finishedAt: timestamp,
				updatedAt: timestamp,
			})
			.where(eq(taskRuns.id, id));
		return this.getRequired(id);
	}

	public async markRetrying(id: string, error: unknown, runAfter: string) {
		const timestamp = nowIso();
		const task = await this.getRequired(id);
		await this.db
			.update(taskRuns)
			.set({
				status: "retrying",
				attempts: task.attempts + 1,
				runAfter,
				errorJson: stringifyJson(error),
				updatedAt: timestamp,
			})
			.where(eq(taskRuns.id, id));
		return this.getRequired(id);
	}

	public async markSuppressed(id: string, error: unknown) {
		const timestamp = nowIso();
		await this.db
			.update(taskRuns)
			.set({
				status: "suppressed",
				errorJson: stringifyJson(error),
				finishedAt: timestamp,
				updatedAt: timestamp,
			})
			.where(eq(taskRuns.id, id));
		return this.getRequired(id);
	}

	public async markSkipped(id: string, skipReason: string, result?: unknown) {
		const timestamp = nowIso();
		await this.db
			.update(taskRuns)
			.set({
				status: "skipped",
				skipReason,
				resultJson: result === undefined ? null : stringifyJson(result),
				finishedAt: timestamp,
				updatedAt: timestamp,
			})
			.where(eq(taskRuns.id, id));
		return this.getRequired(id);
	}

	public async markBlocked(id: string, blockReason: string, error?: unknown) {
		const timestamp = nowIso();
		await this.db
			.update(taskRuns)
			.set({
				status: "blocked",
				blockReason,
				errorJson: error === undefined ? null : stringifyJson(error),
				finishedAt: timestamp,
				updatedAt: timestamp,
			})
			.where(eq(taskRuns.id, id));
		return this.getRequired(id);
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
		const run = await this.createScheduledTaskRun({
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

	public async cancel(id: string, reason: unknown) {
		const timestamp = nowIso();
		await this.db
			.update(taskRuns)
			.set({
				status: "cancelled",
				errorJson: stringifyJson(reason),
				finishedAt: timestamp,
				updatedAt: timestamp,
			})
			.where(eq(taskRuns.id, id));
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
		const id = `delivery_${randomUUID().replaceAll("-", "")}`;
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

	public createDelivery(
		input: Parameters<typeof this.createNotificationDelivery>[0],
	) {
		return this.createNotificationDelivery(input);
	}
}
