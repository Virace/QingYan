import { afterEach, describe, expect, it, vi } from "vitest";

import { taskRuns } from "../../src/db/schema";
import { DatabaseTaskQueue } from "../../src/modules/tasks/database-task-queue";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import { NotificationWorker } from "../../src/modules/notifications/notification-worker";
import { NotificationChannelError } from "../../src/modules/notifications/channels/error-classifier";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

async function createQueuedTask(
	repository: TaskRunRepository,
	input?: {
		recipientType?: "backend_user" | "commenter";
		recipientAddress?: string;
		maxAttempts?: number;
	},
) {
	const task = await repository.create({
		queueBackend: "database",
		type: "channel_test",
		category: "notification",
		payload: {
			templateContext: {
				site: { name: "FangYuan" },
				comment: { content: "hello" },
			},
		},
		payloadSummary: { channel: "email" },
		maxAttempts: input?.maxAttempts ?? 2,
	});
	const delivery = await repository.createDelivery({
		taskRunId: task.id,
		channel: "email",
		recipientType: input?.recipientType ?? "backend_user",
		recipientAddressSnapshot:
			input?.recipientAddress ?? "recipient@example.test",
		recipientIdentityKey: input?.recipientAddress ?? "recipient@example.test",
		eventFamily: "channel_test",
		templateKey: "channel_test",
	});
	return { task, delivery };
}

describe("notification worker", () => {
	it("marks successful email task and delivery as sent", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const repository = new TaskRunRepository(fixture.app.db);
		const { task, delivery } = await createQueuedTask(repository);
		const send = vi.fn(async () => ({ providerMessageId: "smtp-1" }));
		const worker = new NotificationWorker({
			queue: new DatabaseTaskQueue(fixture.app.db),
			repository,
			adapters: { email: { send } },
		});

		const processed = await worker.runNextNotificationTask({ limit: 1 });

		expect(processed).toBe(1);
		await expect(repository.getRequired(task.id)).resolves.toMatchObject({
			status: "succeeded",
			result: { sent: 1, failed: 0 },
		});
		await expect(
			repository.getDeliveryRequired(delivery.id),
		).resolves.toMatchObject({
			status: "sent",
			providerMessageId: "smtp-1",
		});
	});

	it("retries temporary failures with runAfter", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const repository = new TaskRunRepository(fixture.app.db);
		const { task } = await createQueuedTask(repository, { maxAttempts: 3 });
		const worker = new NotificationWorker({
			queue: new DatabaseTaskQueue(fixture.app.db),
			repository,
			adapters: {
				email: {
					send: async () => {
						throw new NotificationChannelError("temporary", "timeout");
					},
				},
			},
			retryDelaySec: 60,
		});

		await worker.runNextNotificationTask({
			limit: 1,
			now: new Date("2026-06-02T10:00:00.000Z"),
		});

		await expect(repository.getRequired(task.id)).resolves.toMatchObject({
			status: "retrying",
			attempts: 1,
			runAfter: "2026-06-02T10:01:00.000Z",
		});
	});

	it("does not update reputation for config errors or backend-user recipient failures", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const repository = new TaskRunRepository(fixture.app.db);
		await createQueuedTask(repository, { recipientType: "backend_user" });
		const reputation = {
			recordRecipientFailure: vi.fn(),
			recordSuccess: vi.fn(),
		};
		const worker = new NotificationWorker({
			queue: new DatabaseTaskQueue(fixture.app.db),
			repository,
			adapters: {
				email: {
					send: async () => {
						throw new NotificationChannelError("config", "missing smtp");
					},
				},
			},
			reputation,
		});

		await worker.runNextNotificationTask({ limit: 1 });

		expect(reputation.recordRecipientFailure).not.toHaveBeenCalled();
		expect(await fixture.app.db.select().from(taskRuns)).toEqual([
			expect.objectContaining({ status: "failed" }),
		]);
	});

	it("increments reputation only for commenter recipient failures", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const repository = new TaskRunRepository(fixture.app.db);
		const { task } = await createQueuedTask(repository, {
			recipientType: "commenter",
			recipientAddress: "commenter@example.test",
		});
		const reputation = {
			recordRecipientFailure: vi.fn(),
			recordSuccess: vi.fn(),
		};
		const worker = new NotificationWorker({
			queue: new DatabaseTaskQueue(fixture.app.db),
			repository,
			adapters: {
				email: {
					send: async () => {
						throw new NotificationChannelError(
							"recipient_permanent",
							"mailbox unavailable",
						);
					},
				},
			},
			reputation,
		});

		await worker.runNextNotificationTask({ limit: 1 });

		expect(reputation.recordRecipientFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				email: "commenter@example.test",
				reason: "mailbox unavailable",
			}),
		);
		await expect(repository.getRequired(task.id)).resolves.toMatchObject({
			status: "failed",
		});
	});
});
