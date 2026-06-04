import { randomUUID } from "node:crypto";

import { and, count, eq, gt, sql } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { taskEventLogs } from "../../db/schema";
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
	public constructor(private readonly db: AppDatabase) {}

	private async nextSequence(taskRunId: string): Promise<number> {
		const [row] = await this.db
			.select({
				value: sql<number>`COALESCE(MAX(${taskEventLogs.sequence}), 0) + 1`,
			})
			.from(taskEventLogs)
			.where(eq(taskEventLogs.taskRunId, taskRunId));
		return Number(row?.value ?? 1);
	}

	public async append(input: {
		id?: string;
		taskRunId: string;
		sequence?: number;
		stream?: TaskLogStream;
		eventType: string;
		level: TaskLogLevel;
		message: string;
		data?: unknown;
		visibleToSiteAdmin?: boolean;
		createdAt?: string;
	}) {
		const id = input.id ?? createTaskEventLogId();
		const sequence = input.sequence ?? (await this.nextSequence(input.taskRunId));
		await this.db.insert(taskEventLogs).values({
			id,
			taskRunId: input.taskRunId,
			sequence,
			stream: input.stream ?? "system",
			eventType: input.eventType,
			level: input.level,
			message: input.message,
			dataJson: input.data === undefined ? null : stringifyJson(input.data),
			visibleToSiteAdmin: input.visibleToSiteAdmin ?? false,
			createdAt: input.createdAt ?? nowIso(),
		});
		const [row] = await this.db
			.select()
			.from(taskEventLogs)
			.where(eq(taskEventLogs.id, id))
			.limit(1);
		return serializeEventLog(row);
	}

	public async appendLogLine(input: {
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
