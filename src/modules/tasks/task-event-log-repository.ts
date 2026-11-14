import { randomUUID } from "node:crypto";

import { and, count, eq, gt, sql } from "drizzle-orm";

import type { DatabaseExecutor } from "../../db/client";
import { taskEventLogs, taskRuns } from "../../db/schema";
import { parseNullableJson, stringifyJson } from "./types";

function nowIso(): string {
	return new Date().toISOString();
}

function createTaskEventLogId(): string {
	return `task_event_${randomUUID().replaceAll("-", "")}`;
}

export interface TaskEventLogRecord {
	id: string;
	taskRunId: string;
	sequence: number;
	stream: TaskLogStream;
	eventType: string;
	level: TaskLogLevel;
	message: string;
	data: unknown;
	visibleToSiteAdmin: boolean;
	createdAt: string;
}

export type TaskLogStream = "stdout" | "stderr" | "system";
export type TaskLogLevel = "debug" | "info" | "warn" | "error";

function serializeEventLog(
	row: typeof taskEventLogs.$inferSelect,
): TaskEventLogRecord {
	return {
		id: row.id,
		taskRunId: row.taskRunId,
		sequence: row.sequence,
		stream: row.stream as TaskLogStream,
		eventType: row.eventType,
		level: row.level as TaskLogLevel,
		message: row.message,
		data: parseNullableJson(row.dataJson),
		visibleToSiteAdmin: row.visibleToSiteAdmin,
		createdAt: row.createdAt,
	};
}

export class TaskEventLogRepository {
	public constructor(private readonly db: DatabaseExecutor) {}

	public async append(input: {
		id?: string;
		taskRunId: string;
		sequence?: number;
		claimToken?: string | null;
		stream?: TaskLogStream;
		eventType: string;
		level: TaskLogLevel;
		message: string;
		data?: unknown;
		visibleToSiteAdmin?: boolean;
		createdAt?: string;
	}) {
		return this.db.transaction(async (tx) => {
			const [parent] = await tx
				.select({
					id: taskRuns.id,
					claimToken: taskRuns.claimToken,
					status: taskRuns.status,
				})
				.from(taskRuns)
				.where(eq(taskRuns.id, input.taskRunId))
				.for("update");
			if (!parent) throw new Error(`Task run not found: ${input.taskRunId}`);
			if (
				input.claimToken !== undefined &&
				(!input.claimToken ||
					parent.claimToken !== input.claimToken ||
					parent.status !== "running")
			)
				return null;
			const [sequenceRow] = await tx
				.select({
					value: sql<number>`coalesce(max(${taskEventLogs.sequence}), 0) + 1`,
				})
				.from(taskEventLogs)
				.where(eq(taskEventLogs.taskRunId, input.taskRunId));
			const [row] = await tx
				.insert(taskEventLogs)
				.values({
					id: input.id ?? createTaskEventLogId(),
					taskRunId: input.taskRunId,
					sequence: input.sequence ?? Number(sequenceRow.value),
					stream: input.stream ?? "system",
					eventType: input.eventType,
					level: input.level,
					message: input.message,
					dataJson: input.data === undefined ? null : stringifyJson(input.data),
					visibleToSiteAdmin: input.visibleToSiteAdmin ?? false,
					createdAt: input.createdAt ?? nowIso(),
				})
				.returning();
			return serializeEventLog(row);
		});
	}

	public async appendLogLine(input: {
		claimToken?: string | null;
		id?: string;
		taskRunId: string;
		stream: TaskLogStream;
		level?: TaskLogLevel;
		message: string;
		eventType?: string;
		data?: unknown;
		visibleToSiteAdmin?: boolean;
		createdAt?: string;
	}) {
		return this.append({
			claimToken: input.claimToken,
			id: input.id,
			taskRunId: input.taskRunId,
			stream: input.stream,
			eventType: input.eventType ?? `log.${input.stream}`,
			level: input.level ?? (input.stream === "stderr" ? "warn" : "info"),
			message: input.message,
			data: input.data,
			visibleToSiteAdmin: input.visibleToSiteAdmin ?? true,
			createdAt: input.createdAt,
		});
	}

	public async listForRun(input: {
		taskRunId: string;
		limit: number;
		offset: number;
		includePrivate?: boolean;
	}) {
		const whereCondition = and(
			eq(taskEventLogs.taskRunId, input.taskRunId),
			input.includePrivate
				? undefined
				: eq(taskEventLogs.visibleToSiteAdmin, true),
		);
		const rows = await this.db
			.select()
			.from(taskEventLogs)
			.where(whereCondition)
			.orderBy(taskEventLogs.sequence, taskEventLogs.createdAt)
			.limit(input.limit)
			.offset(input.offset);
		const [total] = await this.db
			.select({ value: count() })
			.from(taskEventLogs)
			.where(whereCondition);
		return {
			items: rows.map(serializeEventLog),
			totalCount: Number(total?.value ?? 0),
		};
	}

	public async listForRunAfter(input: {
		taskRunId: string;
		afterSequence?: number;
		limit: number;
		includePrivate?: boolean;
	}) {
		const limit = Math.max(1, input.limit);
		const whereCondition = and(
			eq(taskEventLogs.taskRunId, input.taskRunId),
			gt(taskEventLogs.sequence, input.afterSequence ?? 0),
			input.includePrivate
				? undefined
				: eq(taskEventLogs.visibleToSiteAdmin, true),
		);
		const rows = await this.db
			.select()
			.from(taskEventLogs)
			.where(whereCondition)
			.orderBy(taskEventLogs.sequence, taskEventLogs.createdAt)
			.limit(limit + 1);
		const visibleRows = rows.slice(0, limit);
		const items = visibleRows.map(serializeEventLog);
		return {
			items,
			nextSequence: items.at(-1)?.sequence ?? input.afterSequence ?? 0,
			hasMore: rows.length > limit,
		};
	}
}
