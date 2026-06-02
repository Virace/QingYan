import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { DatabaseTaskQueue } from "../../src/modules/tasks/database-task-queue";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import {
	applyInitialMigration,
	createTestWorkspace,
	type TestWorkspace,
} from "../support/test-fixtures";

interface Fixture {
	workspace: TestWorkspace;
	db: ReturnType<typeof createDatabaseClients>["db"];
	sqlite: ReturnType<typeof createDatabaseClients>["sqlite"];
	repository: TaskRunRepository;
	queue: DatabaseTaskQueue;
}

const fixtures: Fixture[] = [];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		fixture.sqlite.close();
		fixture.workspace.cleanup();
	}
});

function createFixture(): Fixture {
	const workspace = createTestWorkspace("qingyan-task-runs-");
	applyInitialMigration(workspace.databaseFile);
	const clients = createDatabaseClients(workspace.databaseFile);
	const repository = new TaskRunRepository(clients.db);
	const queue = new DatabaseTaskQueue(clients.db);
	const fixture = {
		workspace,
		db: clients.db,
		sqlite: clients.sqlite,
		repository,
		queue,
	};
	fixtures.push(fixture);
	return fixture;
}

describe("task run repository and database queue", () => {
	it("serializes task run JSON fields and delivery recipient snapshots", async () => {
		const { repository } = createFixture();
		const task = await repository.create({
			type: "notification.reply_approved",
			category: "notification",
			queueBackend: "database",
			siteKey: "fangyuan",
			payloadSummary: {
				eventType: "reply_approved",
				recipientAddressSnapshot: "reader@example.test",
			},
			payload: {
				commentId: "comment_1",
				body: "kept out of task-center summary",
			},
			result: { ok: true },
			error: { code: "TEMPORARY_FAILURE" },
			maxAttempts: 3,
		});

		const delivery = await repository.createNotificationDelivery({
			taskRunId: task.id,
			channel: "email",
			recipientType: "commenter",
			recipientUserId: null,
			recipientAddressSnapshot: "reader@example.test",
			recipientIdentityKey: "sha256:reader",
			eventFamily: "reply_approved",
			templateKey: "commenter.reply_approved",
			status: "queued",
		});

		expect(task).toMatchObject({
			type: "notification.reply_approved",
			category: "notification",
			status: "queued",
			payloadSummary: {
				eventType: "reply_approved",
				recipientAddressSnapshot: "reader@example.test",
			},
			payload: {
				commentId: "comment_1",
				body: "kept out of task-center summary",
			},
			result: { ok: true },
			error: { code: "TEMPORARY_FAILURE" },
			maxAttempts: 3,
		});
		expect(delivery).toMatchObject({
			taskRunId: task.id,
			channel: "email",
			recipientType: "commenter",
			recipientAddressSnapshot: "reader@example.test",
			recipientIdentityKey: "sha256:reader",
			eventFamily: "reply_approved",
			templateKey: "commenter.reply_approved",
			status: "queued",
		});
	});

	it("uses idempotency keys to return the existing task run", async () => {
		const { repository } = createFixture();

		const first = await repository.create({
			type: "notification.admin_comment_pending",
			category: "notification",
			payloadSummary: { commentId: "comment_1" },
			payload: { commentId: "comment_1" },
			idempotencyKey: "admin:comment_pending:comment_1:email:user_1",
		});
		const second = await repository.create({
			type: "notification.admin_comment_pending",
			category: "notification",
			payloadSummary: { commentId: "comment_1", duplicate: true },
			payload: { commentId: "comment_1", duplicate: true },
			idempotencyKey: "admin:comment_pending:comment_1:email:user_1",
		});
		const listed = await repository.listForTaskCenter({
			category: "notification",
			limit: 10,
			offset: 0,
		});

		expect(second.id).toBe(first.id);
		expect(listed.totalCount).toBe(1);
		expect(listed.items[0].payloadSummary).toEqual({ commentId: "comment_1" });
	});

	it("enqueues immediate and delayed task runs", async () => {
		const { queue } = createFixture();

		const queued = await queue.enqueue({
			type: "notification.admin_comment_pending",
			category: "notification",
			payloadSummary: { commentId: "comment_1" },
			payload: { commentId: "comment_1" },
		});
		const delayed = await queue.enqueue({
			type: "notification.channel_test",
			category: "notification",
			payloadSummary: { channel: "email" },
			payload: { channel: "email" },
			runAfter: "2099-01-01T00:00:00.000Z",
		});

		expect(queued.status).toBe("queued");
		expect(delayed).toMatchObject({
			status: "delayed",
			runAfter: "2099-01-01T00:00:00.000Z",
		});
	});

	it("claims due task runs and marks them running", async () => {
		const { queue } = createFixture();
		await queue.enqueue({
			type: "notification.admin_comment_pending",
			category: "notification",
			payloadSummary: { commentId: "comment_1" },
			payload: { commentId: "comment_1" },
		});
		await queue.enqueue({
			type: "notification.channel_test",
			category: "notification",
			payloadSummary: { channel: "email" },
			payload: { channel: "email" },
			runAfter: "2099-01-01T00:00:00.000Z",
		});

		const claimed = await queue.claim("worker-1", {
			nowIso: "2026-06-02T00:00:00.000Z",
			limit: 10,
		});

		expect(claimed).toHaveLength(1);
		expect(claimed[0]).toMatchObject({
			type: "notification.admin_comment_pending",
			status: "running",
			progress: { workerId: "worker-1" },
			startedAt: expect.any(String),
		});
	});

	it("retries task runs and then records final failures", async () => {
		const { queue, repository } = createFixture();
		const task = await queue.enqueue({
			type: "notification.reply_approved",
			category: "notification",
			payloadSummary: { commentId: "reply_1" },
			payload: { commentId: "reply_1" },
			maxAttempts: 2,
		});
		await queue.claim("worker-1", {
			nowIso: "2026-06-02T00:00:00.000Z",
			limit: 1,
		});

		const retrying = await queue.retry(
			task.id,
			{ code: "TEMPORARY_FAILURE" },
			"2026-06-02T00:05:00.000Z",
		);
		const retryingTask = await repository.getRequired(task.id);
		await queue.fail(task.id, {
			code: "SMTP_REJECTED",
			message: "mailbox unavailable",
		});
		const failed = await repository.getRequired(task.id);

		expect(retrying).toBeUndefined();
		expect(retryingTask).toMatchObject({
			status: "retrying",
			attempts: 1,
			runAfter: "2026-06-02T00:05:00.000Z",
			error: { code: "TEMPORARY_FAILURE" },
		});
		expect(failed).toMatchObject({
			status: "failed",
			attempts: 2,
			error: {
				code: "SMTP_REJECTED",
				message: "mailbox unavailable",
			},
			finishedAt: expect.any(String),
		});
	});

	it("acks, suppresses, and cancels task runs", async () => {
		const { queue, repository } = createFixture();
		const success = await queue.enqueue({
			type: "notification.channel_test",
			category: "notification",
			payloadSummary: { channel: "email" },
			payload: { channel: "email" },
		});
		const suppressed = await queue.enqueue({
			type: "notification.reply_approved",
			category: "notification",
			payloadSummary: { reason: "email_reputation" },
			payload: { reason: "email_reputation" },
		});
		const cancelled = await queue.enqueue({
			type: "notification.admin_comment_pending",
			category: "notification",
			payloadSummary: { commentId: "comment_2" },
			payload: { commentId: "comment_2" },
		});

		expect(
			await queue.ack(success.id, { providerMessageId: "smtp-1" }),
		).toBeUndefined();
		expect(await repository.getRequired(success.id)).toMatchObject({
			status: "succeeded",
			result: { providerMessageId: "smtp-1" },
		});
		expect(
			await repository.markSuppressed(suppressed.id, {
				reason: "email_reputation",
			}),
		).toMatchObject({
			status: "suppressed",
			error: { reason: "email_reputation" },
		});
		expect(
			await queue.cancel(cancelled.id, { reason: "manual" }),
		).toBeUndefined();
		expect(await repository.getRequired(cancelled.id)).toMatchObject({
			status: "cancelled",
			error: { reason: "manual" },
		});
	});
});
