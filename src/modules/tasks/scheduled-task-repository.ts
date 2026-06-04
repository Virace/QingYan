import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull, lte } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { scheduledTaskDeletedSnapshots, scheduledTasks } from "../../db/schema";
import {
	parseProtectedTaskPolicy,
	type ProtectedTaskPolicy,
} from "./protected-task-policy";
import { stringifyJson, type TaskRunStatus } from "./types";

const DEFAULT_RETENTION_COUNT_MAX = 30;

function nowIso(): string {
	return new Date().toISOString();
}

function createScheduledTaskId(): string {
	return `scheduled_task_${randomUUID().replaceAll("-", "")}`;
}

function createDeletedSnapshotId(): string {
	return `scheduled_task_deleted_${randomUUID().replaceAll("-", "")}`;
}

export interface ScheduledTaskCreateInput {
	id?: string;
	name: string;
	description?: string | null;
	type: string;
	siteId?: number | null;
	scopeKind: string;
	scope: unknown;
	enabled?: boolean;
	disabledReason?: string | null;
	scheduleKind: string;
	schedulePreset?: string | null;
	cronExpression?: string | null;
	timezone?: string | null;
	payload: unknown;
	payloadSchemaVersion?: number;
	systemKey?: string | null;
	protection?: ProtectedTaskPolicy | null;
	policy: unknown;
	trigger: unknown;
	triggerSchemaVersion?: number;
	nextRunAt?: string | null;
	claimWorkerId?: string | null;
	claimExpiresAt?: string | null;
	lastRunAt?: string | null;
	lastRunId?: string | null;
	lastStatus?: TaskRunStatus | null;
	retentionCount?: number;
	ownerUserId: number;
	createdByUserId?: number | null;
	updatedByUserId?: number | null;
	transferredByUserId?: number | null;
	transferredAt?: string | null;
	createdAt?: string;
	updatedAt?: string;
}

export interface ScheduledTaskUpdateInput {
	name?: string;
	description?: string | null;
	siteId?: number | null;
	scopeKind?: string;
	scope?: unknown;
	enabled?: boolean;
	disabledReason?: string | null;
	scheduleKind?: string;
	schedulePreset?: string | null;
	cronExpression?: string | null;
	timezone?: string | null;
	payload?: unknown;
	payloadSchemaVersion?: number;
	systemKey?: string | null;
	protection?: ProtectedTaskPolicy | null;
	policy?: unknown;
	trigger?: unknown;
	triggerSchemaVersion?: number;
	nextRunAt?: string | null;
	claimWorkerId?: string | null;
	claimExpiresAt?: string | null;
	lastRunAt?: string | null;
	lastRunId?: string | null;
	lastStatus?: TaskRunStatus | null;
	retentionCount?: number;
	ownerUserId?: number;
	updatedByUserId?: number | null;
	transferredByUserId?: number | null;
	transferredAt?: string | null;
	updatedAt?: string;
}

export interface ScheduledTaskRecord {
	id: string;
	name: string;
	description: string | null;
	type: string;
	siteId: number | null;
	scopeKind: string;
	scope: unknown;
	enabled: boolean;
	disabledReason: string | null;
	scheduleKind: string;
	schedulePreset: string | null;
	cronExpression: string | null;
	timezone: string | null;
	payload: unknown;
	payloadSchemaVersion: number;
	systemKey: string | null;
	protection: ProtectedTaskPolicy | null;
	policy: unknown;
	trigger: unknown;
	triggerSchemaVersion: number;
	nextRunAt: string | null;
	claimWorkerId: string | null;
	claimExpiresAt: string | null;
	lastRunAt: string | null;
	lastRunId: string | null;
	lastStatus: TaskRunStatus | null;
	retentionCount: number;
	ownerUserId: number;
	createdByUserId: number | null;
	updatedByUserId: number | null;
	transferredByUserId: number | null;
	transferredAt: string | null;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface ScheduledTaskDeletedSnapshotRecord {
	id: string;
	scheduledTaskId: string;
	snapshot: ScheduledTaskRecord;
	deletedByUserId: number | null;
	deletedAt: string;
	deleteReason: string | null;
	lastRunId: string | null;
	lastStatus: TaskRunStatus | null;
}

function serializeScheduledTask(
	row: typeof scheduledTasks.$inferSelect,
): ScheduledTaskRecord {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		type: row.type,
		siteId: row.siteId,
		scopeKind: row.scopeKind,
		scope: JSON.parse(row.scopeJson) as unknown,
		enabled: row.enabled,
		disabledReason: row.disabledReason,
		scheduleKind: row.scheduleKind,
		schedulePreset: row.schedulePreset,
		cronExpression: row.cronExpression,
		timezone: row.timezone,
		payload: JSON.parse(row.payloadJson) as unknown,
		payloadSchemaVersion: row.payloadSchemaVersion,
		systemKey: row.systemKey,
		protection: parseProtectedTaskPolicy(
			row.protectionJson ? JSON.parse(row.protectionJson) : null,
		),
		policy: JSON.parse(row.policyJson) as unknown,
		trigger: JSON.parse(row.triggerJson) as unknown,
		triggerSchemaVersion: row.triggerSchemaVersion,
		nextRunAt: row.nextRunAt,
		claimWorkerId: row.claimWorkerId,
		claimExpiresAt: row.claimExpiresAt,
		lastRunAt: row.lastRunAt,
		lastRunId: row.lastRunId,
		lastStatus: row.lastStatus as TaskRunStatus | null,
		retentionCount: row.retentionCount,
		ownerUserId: row.ownerUserId,
		createdByUserId: row.createdByUserId,
		updatedByUserId: row.updatedByUserId,
		transferredByUserId: row.transferredByUserId,
		transferredAt: row.transferredAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
	};
}

function serializeDeletedSnapshot(
	row: typeof scheduledTaskDeletedSnapshots.$inferSelect,
): ScheduledTaskDeletedSnapshotRecord {
	return {
		id: row.id,
		scheduledTaskId: row.scheduledTaskId,
		snapshot: JSON.parse(row.snapshotJson) as ScheduledTaskRecord,
		deletedByUserId: row.deletedByUserId,
		deletedAt: row.deletedAt,
		deleteReason: row.deleteReason,
		lastRunId: row.lastRunId,
		lastStatus: row.lastStatus as TaskRunStatus | null,
	};
}

export class ScheduledTaskRepository {
	private readonly retentionCountMax: number;

	public constructor(
		private readonly db: AppDatabase,
		options?: { retentionCountMax?: number },
	) {
		this.retentionCountMax =
			options?.retentionCountMax ?? DEFAULT_RETENTION_COUNT_MAX;
	}

	public async create(input: ScheduledTaskCreateInput) {
		const timestamp = input.createdAt ?? nowIso();
		const id = input.id ?? createScheduledTaskId();
		await this.db.insert(scheduledTasks).values({
			id,
			name: input.name,
			description: input.description ?? null,
			type: input.type,
			siteId: input.siteId ?? null,
			scopeKind: input.scopeKind,
			scopeJson: stringifyJson(input.scope),
			enabled: input.enabled ?? false,
			disabledReason: input.disabledReason ?? null,
			scheduleKind: input.scheduleKind,
			schedulePreset: input.schedulePreset ?? null,
			cronExpression: input.cronExpression ?? null,
			timezone: input.timezone ?? null,
			payloadJson: stringifyJson(input.payload),
			payloadSchemaVersion: input.payloadSchemaVersion ?? 1,
			systemKey: input.systemKey ?? null,
			protectionJson:
				input.protection === undefined || input.protection === null
					? null
					: stringifyJson(input.protection),
			policyJson: stringifyJson(input.policy),
			triggerJson: stringifyJson(input.trigger),
			triggerSchemaVersion: input.triggerSchemaVersion ?? 1,
			nextRunAt: input.nextRunAt ?? null,
			claimWorkerId: input.claimWorkerId ?? null,
			claimExpiresAt: input.claimExpiresAt ?? null,
			lastRunAt: input.lastRunAt ?? null,
			lastRunId: input.lastRunId ?? null,
			lastStatus: input.lastStatus ?? null,
			retentionCount: this.clampRetentionCount(input.retentionCount ?? 5),
			ownerUserId: input.ownerUserId,
			createdByUserId: input.createdByUserId ?? null,
			updatedByUserId: input.updatedByUserId ?? null,
			transferredByUserId: input.transferredByUserId ?? null,
			transferredAt: input.transferredAt ?? null,
			createdAt: timestamp,
			updatedAt: input.updatedAt ?? timestamp,
			deletedAt: null,
		});
		return this.getRequired(id);
	}

	public async update(id: string, input: ScheduledTaskUpdateInput) {
		const timestamp = input.updatedAt ?? nowIso();
		await this.db
			.update(scheduledTasks)
			.set({
				name: input.name,
				description: input.description,
				siteId: input.siteId,
				scopeKind: input.scopeKind,
				scopeJson:
					input.scope === undefined ? undefined : stringifyJson(input.scope),
				enabled: input.enabled,
				disabledReason: input.disabledReason,
				scheduleKind: input.scheduleKind,
				schedulePreset: input.schedulePreset,
				cronExpression: input.cronExpression,
				timezone: input.timezone,
				payloadJson:
					input.payload === undefined
						? undefined
						: stringifyJson(input.payload),
				payloadSchemaVersion: input.payloadSchemaVersion,
				systemKey: input.systemKey,
				protectionJson:
					input.protection === undefined
						? undefined
						: input.protection === null
							? null
							: stringifyJson(input.protection),
				policyJson:
					input.policy === undefined ? undefined : stringifyJson(input.policy),
				triggerJson:
					input.trigger === undefined
						? undefined
						: stringifyJson(input.trigger),
				triggerSchemaVersion: input.triggerSchemaVersion,
				nextRunAt: input.nextRunAt,
				claimWorkerId: input.claimWorkerId,
				claimExpiresAt: input.claimExpiresAt,
				lastRunAt: input.lastRunAt,
				lastRunId: input.lastRunId,
				lastStatus: input.lastStatus,
				retentionCount:
					input.retentionCount === undefined
						? undefined
						: this.clampRetentionCount(input.retentionCount),
				ownerUserId: input.ownerUserId,
				updatedByUserId: input.updatedByUserId,
				transferredByUserId: input.transferredByUserId,
				transferredAt: input.transferredAt,
				updatedAt: timestamp,
			})
			.where(and(eq(scheduledTasks.id, id), isNull(scheduledTasks.deletedAt)));
		return this.getRequired(id);
	}

	public async get(id: string) {
		const [row] = await this.db
			.select()
			.from(scheduledTasks)
			.where(and(eq(scheduledTasks.id, id), isNull(scheduledTasks.deletedAt)))
			.limit(1);
		return row ? serializeScheduledTask(row) : null;
	}

	public async getRequired(id: string) {
		const task = await this.get(id);
		if (!task) {
			throw new Error(`Scheduled task not found: ${id}`);
		}
		return task;
	}

	public async getBySystemKey(systemKey: string) {
		const [row] = await this.db
			.select()
			.from(scheduledTasks)
			.where(
				and(
					eq(scheduledTasks.systemKey, systemKey),
					isNull(scheduledTasks.deletedAt),
				),
			)
			.limit(1);
		return row ? serializeScheduledTask(row) : null;
	}

	public async list(input?: { limit?: number; offset?: number }) {
		const rows = await this.db
			.select()
			.from(scheduledTasks)
			.where(isNull(scheduledTasks.deletedAt))
			.orderBy(desc(scheduledTasks.createdAt))
			.limit(input?.limit ?? 50)
			.offset(input?.offset ?? 0);
		return rows.map(serializeScheduledTask);
	}

	public async listDue(nowIso: string, input?: { limit?: number }) {
		const rows = await this.db
			.select()
			.from(scheduledTasks)
			.where(
				and(
					eq(scheduledTasks.enabled, true),
					isNull(scheduledTasks.deletedAt),
					lte(scheduledTasks.nextRunAt, nowIso),
				),
			)
			.orderBy(scheduledTasks.nextRunAt)
			.limit(input?.limit ?? 50);
		return rows.map(serializeScheduledTask);
	}

	public async claimDue(
		id: string,
		input: {
			nowIso: string;
			workerId: string;
			claimExpiresAt: string;
		},
	) {
		return this.db.transaction((tx) => {
			const row = tx
				.select()
				.from(scheduledTasks)
				.where(
					and(
						eq(scheduledTasks.id, id),
						eq(scheduledTasks.enabled, true),
						isNull(scheduledTasks.deletedAt),
						lte(scheduledTasks.nextRunAt, input.nowIso),
					),
				)
				.get();
			if (!row) {
				return null;
			}
			if (
				row.claimExpiresAt &&
				row.claimExpiresAt > input.nowIso &&
				row.claimWorkerId !== input.workerId
			) {
				return null;
			}
			tx.update(scheduledTasks)
				.set({
					claimWorkerId: input.workerId,
					claimExpiresAt: input.claimExpiresAt,
					updatedAt: input.nowIso,
				})
				.where(eq(scheduledTasks.id, id))
				.run();
			const claimed = tx
				.select()
				.from(scheduledTasks)
				.where(eq(scheduledTasks.id, id))
				.get();
			return claimed ? serializeScheduledTask(claimed) : null;
		});
	}

	public async enable(
		id: string,
		input?: { updatedByUserId?: number | null; updatedAt?: string },
	) {
		return this.update(id, {
			enabled: true,
			disabledReason: null,
			updatedByUserId: input?.updatedByUserId,
			updatedAt: input?.updatedAt,
		});
	}

	public async disable(
		id: string,
		input: {
			reason: string;
			updatedByUserId?: number | null;
			updatedAt?: string;
		},
	) {
		return this.update(id, {
			enabled: false,
			disabledReason: input.reason,
			updatedByUserId: input.updatedByUserId,
			updatedAt: input.updatedAt,
		});
	}

	public async updateLastRun(
		id: string,
		input: {
			lastRunAt: string;
			lastRunId: string;
			lastStatus: TaskRunStatus;
			updatedAt?: string;
		},
	) {
		return this.update(id, {
			lastRunAt: input.lastRunAt,
			lastRunId: input.lastRunId,
			lastStatus: input.lastStatus,
			updatedAt: input.updatedAt,
		});
	}

	public async updateAfterRun(
		id: string,
		input: {
			lastRunAt: string;
			lastRunId: string;
			lastStatus: TaskRunStatus;
			nextRunAt: string | null;
			enabled?: boolean;
			disabledReason?: string | null;
			updatedAt?: string;
		},
	) {
		return this.update(id, {
			lastRunAt: input.lastRunAt,
			lastRunId: input.lastRunId,
			lastStatus: input.lastStatus,
			nextRunAt: input.nextRunAt,
			claimWorkerId: null,
			claimExpiresAt: null,
			enabled: input.enabled,
			disabledReason: input.disabledReason,
			updatedAt: input.updatedAt,
		});
	}

	public async deleteWithSnapshot(
		id: string,
		input: {
			deletedByUserId?: number | null;
			deleteReason?: string | null;
			deletedAt?: string;
		},
	) {
		const deletedAt = input.deletedAt ?? nowIso();
		return this.db.transaction((tx) => {
			const row = tx
				.select()
				.from(scheduledTasks)
				.where(and(eq(scheduledTasks.id, id), isNull(scheduledTasks.deletedAt)))
				.get();
			if (!row) {
				throw new Error(`Scheduled task not found: ${id}`);
			}
			const snapshot = serializeScheduledTask(row);
			const snapshotId = createDeletedSnapshotId();
			tx.insert(scheduledTaskDeletedSnapshots)
				.values({
					id: snapshotId,
					scheduledTaskId: id,
					snapshotJson: stringifyJson(snapshot),
					deletedByUserId: input.deletedByUserId ?? null,
					deletedAt,
					deleteReason: input.deleteReason ?? null,
					lastRunId: row.lastRunId,
					lastStatus: row.lastStatus,
				})
				.run();
			tx.delete(scheduledTasks).where(eq(scheduledTasks.id, id)).run();
			const saved = tx
				.select()
				.from(scheduledTaskDeletedSnapshots)
				.where(eq(scheduledTaskDeletedSnapshots.id, snapshotId))
				.get();
			if (!saved) {
				throw new Error(
					`Scheduled task deleted snapshot not found: ${snapshotId}`,
				);
			}
			return serializeDeletedSnapshot(saved);
		});
	}

	public async listDeletedSnapshots(input?: {
		limit?: number;
		offset?: number;
	}) {
		const rows = await this.db
			.select()
			.from(scheduledTaskDeletedSnapshots)
			.orderBy(desc(scheduledTaskDeletedSnapshots.deletedAt))
			.limit(input?.limit ?? 50)
			.offset(input?.offset ?? 0);
		return rows.map(serializeDeletedSnapshot);
	}

	public async getDeletedSnapshot(id: string) {
		const [row] = await this.db
			.select()
			.from(scheduledTaskDeletedSnapshots)
			.where(eq(scheduledTaskDeletedSnapshots.id, id))
			.limit(1);
		return row ? serializeDeletedSnapshot(row) : null;
	}

	private clampRetentionCount(value: number): number {
		return Math.max(0, Math.min(value, this.retentionCountMax));
	}
}
