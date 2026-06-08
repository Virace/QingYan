import { describe, expect, it, vi } from "vitest";

import { BullMqTaskQueue } from "../../src/modules/tasks/bullmq-task-queue";

describe("BullMQ task queue adapter", () => {
	it("enqueues through BullMQ while keeping database projection as source of truth", async () => {
		const add = vi.fn(async () => ({ id: "bull-1" }));
		const create = vi.fn(async (task) => ({
			id: "task-1",
			queueBackend: "bullmq",
			queueMessageId: "bull-1",
			...task,
		}));
		const queue = new BullMqTaskQueue({
			queue: { add },
			repository: { create },
		});

		const task = await queue.enqueue({
			type: "channel_test",
			category: "notification",
			payload: { channel: "email" },
			payloadSummary: { channel: "email" },
		});

		expect(add).toHaveBeenCalledWith(
			"channel_test",
			expect.objectContaining({ category: "notification" }),
			expect.objectContaining({ removeOnComplete: true }),
		);
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				queueBackend: "bullmq",
				queueMessageId: "bull-1",
			}),
		);
		expect(task).toMatchObject({
			id: "task-1",
			queueBackend: "bullmq",
			queueMessageId: "bull-1",
		});
	});
});
