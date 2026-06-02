import { Queue } from "bullmq";
import { describe, expect, it } from "vitest";

import { BullMqTaskQueue } from "../../src/modules/tasks/bullmq-task-queue";
import type { TaskRunRecord } from "../../src/modules/tasks/types";

const redisUrl = process.env.QINGYAN_BULLMQ_REDIS_URL;
const runWithRedis = redisUrl ? it : it.skip;

function parseRedisConnection(url: string) {
	const parsed = new URL(url);
	return {
		host: parsed.hostname,
		port: parsed.port ? Number(parsed.port) : 6379,
		username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
		password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
		db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
		maxRetriesPerRequest: null,
	};
}

describe("BullMQ task queue Redis integration", () => {
	runWithRedis(
		"enqueues into a real Redis-backed BullMQ queue",
		async () => {
			const connection = parseRedisConnection(redisUrl ?? "");
			const queueName = `qingyan-bullmq-${Date.now()}-${Math.random()
				.toString(16)
				.slice(2)}`;
			const queue = new Queue(queueName, { connection });
			try {
				const adapter = new BullMqTaskQueue({
					queue,
					repository: {
						create: async (input) => {
							const now = new Date().toISOString();
							const record: TaskRunRecord = {
								id: "task-bullmq-real",
								queueBackend: input.queueBackend,
								queueMessageId: input.queueMessageId,
								type: input.type,
								category: input.category,
								status: "queued",
								siteId: input.siteId ?? null,
								siteKey: input.siteKey ?? null,
								actorType: input.actorType ?? null,
								actorId: input.actorId ?? null,
								subjectType: input.subjectType ?? null,
								subjectId: input.subjectId ?? null,
								payloadSummary: input.payloadSummary ?? null,
								payload: input.payload,
								progress: null,
								result: null,
								error: null,
								idempotencyKey: input.idempotencyKey ?? null,
								runAfter: input.runAfter ?? null,
								attempts: 0,
								maxAttempts: input.maxAttempts ?? 3,
								createdAt: now,
								startedAt: null,
								finishedAt: null,
								updatedAt: now,
							};
							return record;
						},
					},
				});

				const task = await adapter.enqueue({
					type: "channel_test",
					category: "notification",
					siteKey: "default",
					payload: { channel: "email" },
					payloadSummary: { channel: "email" },
				});

				expect(task.queueBackend).toBe("bullmq");
				expect(task.queueMessageId).toBeTruthy();
				const job = await queue.getJob(task.queueMessageId ?? "");
				expect(job?.name).toBe("channel_test");
				expect(job?.data).toMatchObject({
					category: "notification",
					siteKey: "default",
					payload: { channel: "email" },
				});
			} finally {
				await queue.obliterate({ force: true });
				await queue.close();
			}
		},
		10_000,
	);
});
