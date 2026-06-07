import type { TaskQueue, TaskQueuePayload, TaskRunRecord } from "./types";

type BullMqJob = {
	id?: string | number | null;
};

type BullMqQueueLike = {
	add: (
		name: string,
		data: TaskQueuePayload,
		options: Record<string, unknown>,
	) => Promise<BullMqJob>;
};

type BullMqRepositoryLike = {
	create: (
		input: TaskQueuePayload & {
			queueBackend: "bullmq";
			queueMessageId: string | null;
		},
	) => Promise<TaskRunRecord>;
};

export class BullMqTaskQueue implements TaskQueue {
	public constructor(
		private readonly dependencies: {
			queue: BullMqQueueLike;
			repository: BullMqRepositoryLike;
			defaultJobOptions?: Record<string, unknown>;
		},
	) {}

	public async enqueue(task: TaskQueuePayload): Promise<TaskRunRecord> {
		const job = await this.dependencies.queue.add(task.type, task, {
			removeOnComplete: true,
			removeOnFail: false,
			...(task.runAfter
				? { delay: Math.max(0, Date.parse(task.runAfter) - Date.now()) }
				: {}),
			...this.dependencies.defaultJobOptions,
		});
		return this.dependencies.repository.create({
			...task,
			queueBackend: "bullmq",
			queueMessageId:
				job.id === undefined || job.id === null ? null : String(job.id),
		});
	}

	public async claim(): Promise<TaskRunRecord[]> {
		return [];
	}

	public async ack(): Promise<void> {}

	public async retry(): Promise<void> {}

	public async fail(): Promise<void> {}

	public async cancel(): Promise<void> {}
}
