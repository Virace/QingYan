import type { AppDatabase } from "../../db/client";
import { TaskRunRepository } from "./task-run-repository";
import type {
	TaskClaimOptions,
	TaskQueue,
	TaskQueuePayload,
	TaskRunRecord,
} from "./types";

export class DatabaseTaskQueue implements TaskQueue {
	private readonly repository: TaskRunRepository;

	public constructor(db: AppDatabase) {
		this.repository = new TaskRunRepository(db);
	}

	public enqueue(task: TaskQueuePayload): Promise<TaskRunRecord> {
		return this.repository.create({ ...task, queueBackend: "database" });
	}

	public async claim(
		worker: string,
		options: TaskClaimOptions = {},
	): Promise<TaskRunRecord[]> {
		return this.repository.claimRunnable({
			...options,
			workerId: worker,
		});
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
