import { randomUUID } from "node:crypto";

import { and, count, eq } from "drizzle-orm";

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
	eventType: string;
	level: string;
	message: string;
	data: unknown;
	visibleToSiteAdmin: boolean;
	createdAt: string;
}

function serializeEventLog(
	row: typeof taskEventLogs.$inferSelect,
): TaskEventLogRecord {
	return {
		id: row.id,
		taskRunId: row.taskRunId,
		eventType: row.eventType,
		level: row.level,
		message: row.message,
		data: parseNullableJson(row.dataJson),
		visibleToSiteAdmin: row.visibleToSiteAdmin,
		createdAt: row.createdAt,
	};
}

export class TaskEventLogRepository {
	public constructor(private readonly db: AppDatabase) {}

	public async append(input: {
		id?: string;
		taskRunId: string;
		eventType: string;
		level: string;
		message: string;
		data?: unknown;
		visibleToSiteAdmin?: boolean;
		createdAt?: string;
	}) {
		const id = input.id ?? createTaskEventLogId();
		await this.db.insert(taskEventLogs).values({
			id,
			taskRunId: input.taskRunId,
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
			.orderBy(taskEventLogs.createdAt)
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
}
