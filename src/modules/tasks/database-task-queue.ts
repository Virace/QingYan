import { and, inArray, isNull, lte, or } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { taskRuns } from "../../db/schema";
import { TaskRunRepository } from "./task-run-repository";
import type { TaskQueue, TaskQueuePayload, TaskRunRecord } from "./types";

function nowIso(): string {
	return new Date().toISOString();
}

export class DatabaseTaskQueue implements TaskQueue {
	private readonly repository: TaskRunRepository;

	public constructor(private readonly db: AppDatabase) {
		this.repository = new TaskRunRepository(db);
	}

	public enqueue(task: TaskQueuePayload): Promise<TaskRunRecord> {
		return this.repository.create({ ...task, queueBackend: "database" });
	}

	public async claim(
		worker: string,
		options: { nowIso?: string; limit?: number } = {},
	): Promise<TaskRunRecord[]> {
		const timestamp = options.nowIso ?? nowIso();
		const rows = await this.db
			.select()
			.from(taskRuns)
			.where(
				and(
					inArray(taskRuns.status, ["queued", "delayed", "retrying"]),
					or(isNull(taskRuns.runAfter), lte(taskRuns.runAfter, timestamp)),
				),
			)
			.orderBy(taskRuns.runAfter, taskRuns.createdAt)
			.limit(options.limit ?? 1);
		const claimed: TaskRunRecord[] = [];
		for (const row of rows) {
			claimed.push(
				await this.repository.markRunning(row.id, {
					workerId: worker,
				}),
			);
		}
		return claimed;
	}

	public async ack(taskId: string, result: unknown): Promise<void> {
		await this.repository.markSucceeded(taskId, result);
	}

	public retry(
		taskId: string,
		error: unknown,
		runAfter: string,
	): Promise<void> {
		return this.repository.markRetrying(taskId, error, runAfter).then(() => {});
	}

	public async fail(taskId: string, error: unknown): Promise<void> {
		await this.repository.markFailed(taskId, error);
	}

	public async cancel(taskId: string, reason: unknown): Promise<void> {
		await this.repository.cancel(taskId, reason);
	}
}
