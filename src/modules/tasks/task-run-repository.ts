import { randomUUID } from "node:crypto";

import { and, count, desc, eq } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { notificationDeliveries, taskRuns } from "../../db/schema";
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
		type: row.type,
		category: row.category as TaskRunCategory,
		status: row.status as TaskRunStatus,
		siteId: row.siteId,
		siteKey: row.siteKey,
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
			type: input.type,
			category: input.category,
			status,
			siteId: input.siteId ?? null,
			siteKey: input.siteKey ?? null,
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
			createdAt: timestamp,
			startedAt: input.startedAt ?? null,
			finishedAt: input.finishedAt ?? null,
			updatedAt,
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

	public async markRunning(id: string, progress?: unknown) {
		const timestamp = nowIso();
		await this.db
			.update(taskRuns)
			.set({
				status: "running",
				startedAt: timestamp,
				progressJson:
					progress === undefined ? undefined : stringifyJson(progress),
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
