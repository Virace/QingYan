import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseClients } from "../../src/db/client";
import {
	adminUsers,
	notificationDeliveries,
	sites,
	taskEventLogs,
} from "../../src/db/schema";
import { advisoryLockKey } from "../../src/db/values";
import { ScheduledTaskRepository } from "../../src/modules/tasks/scheduled-task-repository";
import { TaskScheduler } from "../../src/modules/tasks/scheduler";
import { TaskEventLogRepository } from "../../src/modules/tasks/task-event-log-repository";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import {
	applyInitialMigration,
	createTestWorkspace,
	type TestWorkspace,
} from "../support/test-fixtures";

interface Fixture {
	workspace: TestWorkspace;
	db: ReturnType<typeof createDatabaseClients>["db"];
	close: ReturnType<typeof createDatabaseClients>["close"];
	scheduledTasks: ScheduledTaskRepository;
	taskRuns: TaskRunRepository;
	eventLogs: TaskEventLogRepository;
	scheduler: TaskScheduler;
	siteId: number;
	adminUserId: number;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
	for (const fixture of fixtures.splice(0)) {
		await fixture.close();
		await fixture.workspace.cleanup();
	}
});

async function createFixture(): Promise<Fixture> {
	const workspace = createTestWorkspace("qingyan-task-run-locks-");
	await applyInitialMigration(workspace.databaseUrl);
	const clients = createDatabaseClients(workspace.databaseUrl);
	await clients.db.insert(sites).values({
		siteKey: "fangyuan",
		name: "FangYuan",
		allowedOriginsJson: "[]",
	});
	const [site] = await clients.db.select().from(sites).limit(1);
	await clients.db.insert(adminUsers).values({
		username: "admin",
		email: "admin@example.test",
		passwordHash: "hash",
		displayName: "Admin",
		isInitialAdmin: true,
	});
	const [adminUser] = await clients.db.select().from(adminUsers).limit(1);
	const scheduledTasks = new ScheduledTaskRepository(clients.db);
	const taskRuns = new TaskRunRepository(clients.db);
	const eventLogs = new TaskEventLogRepository(clients.db);
	const fixture = {
		workspace,
		db: clients.db,
		close: clients.close,
		scheduledTasks,
		taskRuns,
		eventLogs,
		scheduler: new TaskScheduler({
			scheduledTasks,
			taskRuns,
			eventLogs,
			workerId: "worker-a",
		}),
		siteId: site.id,
		adminUserId: adminUser.id,
	};
	fixtures.push(fixture);
	return fixture;
}

describe("scheduled task run locks", () => {
	it("creates a visible failed run and lock event when the concurrency key is busy", async () => {
		const {
			scheduledTasks,
			taskRuns,
			eventLogs,
			scheduler,
			siteId,
			adminUserId,
		} = await createFixture();
		const task = await scheduledTasks.create({
			name: "Refresh titles",
			type: "page_metadata_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "interval",
			payload: { siteKey: "fangyuan", scope: "missing_only" },
			policy: { concurrencyKey: "site:fangyuan:title-refresh" },
			trigger: { everyMinutes: 30 },
			nextRunAt: "2026-06-04T10:00:00.000Z",
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});
		const blockingRun = await taskRuns.createScheduledTaskRun({
			scheduledTask: task,
			trigger: "schedule",
			triggerSnapshot: { dueAt: "2026-06-04T09:30:00.000Z" },
			input: task.payload,
			concurrencyKey: "site:fangyuan:title-refresh",
			status: "running",
			createdAt: "2026-06-04T09:30:00.000Z",
		});

		const tick = await scheduler.tick({
			now: new Date("2026-06-04T10:00:00.000Z"),
		});
		const conflictRun = await taskRuns.getRequired(tick.createdRunIds[0]);
		const events = await eventLogs.listForRun({
			taskRunId: conflictRun.id,
			limit: 10,
			offset: 0,
			includePrivate: true,
		});

		expect(conflictRun).toMatchObject({
			status: "failed",
			error: { code: "TASK_LOCK_CONFLICT" },
			lockConflictWithRunId: blockingRun.id,
			lockConflictWithTaskName: "Refresh titles",
			concurrencyKey: "site:fangyuan:title-refresh",
		});
		expect(events.items).toEqual([
			expect.objectContaining({
				eventType: "lock_conflict",
				level: "warn",
				visibleToSiteAdmin: true,
				data: {
					conflictWithRunId: blockingRun.id,
					concurrencyKey: "site:fangyuan:title-refresh",
				},
			}),
		]);
	});

	it("marks stale running runs as failed and writes an event", async () => {
		const {
			scheduledTasks,
			taskRuns,
			eventLogs,
			scheduler,
			siteId,
			adminUserId,
		} = await createFixture();
		const task = await scheduledTasks.create({
			name: "Refresh sources",
			type: "page_source_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "manual_only",
			payload: { siteKey: "fangyuan" },
			policy: {},
			trigger: { kind: "manual" },
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});
		const run = await taskRuns.createScheduledTaskRun({
			scheduledTask: task,
			trigger: "manual",
			triggerSnapshot: {},
			input: task.payload,
			status: "running",
			createdAt: "2026-06-04T09:00:00.000Z",
			updatedAt: "2026-06-04T09:00:00.000Z",
		});

		const result = await scheduler.markStaleRuns({
			now: new Date("2026-06-04T10:00:00.000Z"),
			staleAfterMs: 10 * 60 * 1000,
		});
		const staleRun = await taskRuns.getRequired(run.id);
		const events = await eventLogs.listForRun({
			taskRunId: run.id,
			limit: 10,
			offset: 0,
			includePrivate: true,
		});

		expect(result.failedRunIds).toEqual([run.id]);
		expect(staleRun).toMatchObject({
			status: "failed",
			error: { code: "TASK_RUN_STALE" },
		});
		expect(events.items).toEqual([
			expect.objectContaining({
				eventType: "stale_run_failed",
				level: "warn",
				visibleToSiteAdmin: true,
			}),
		]);
	});
	it("claims each run once across concurrent transactions with deterministic NULL ordering", async () => {
		const fixture = await createFixture();
		const at = "2026-06-04T10:00:00.000Z";
		const run = await fixture.taskRuns.create({
			type: "claim",
			category: "maintenance",
			payload: {},
			createdAt: at,
		});
		const claims = await Promise.all(
			["a", "b"].map((workerId) =>
				fixture.taskRuns.claimRunnable({ workerId, nowIso: at, limit: 1 }),
			),
		);
		expect(claims.flat().map((task) => task.id)).toEqual([run.id]);
		await fixture.taskRuns.create({
			id: "due",
			type: "claim",
			category: "maintenance",
			payload: {},
			priority: 3,
			runAfter: at,
			createdAt: at,
		});
		await fixture.taskRuns.create({
			id: "null-b",
			type: "claim",
			category: "maintenance",
			payload: {},
			priority: 3,
			createdAt: at,
		});
		await fixture.taskRuns.create({
			id: "null-a",
			type: "claim",
			category: "maintenance",
			payload: {},
			priority: 3,
			createdAt: at,
		});
		const ordered = await fixture.taskRuns.claimRunnable({
			workerId: "ordered",
			nowIso: at,
			limit: 3,
		});
		expect(ordered.map((task) => task.id)).toEqual(["null-a", "null-b", "due"]);
		expect(new Set(ordered.map((task) => task.claimToken)).size).toBe(3);
	});

	it("rejects old claim progress, events, and completion after retry and applies a terminal result once", async () => {
		const { taskRuns, eventLogs } = await createFixture();
		const run = await taskRuns.create({
			type: "fence",
			category: "maintenance",
			payload: {},
		});
		const first = (await taskRuns.claimRunnable({ workerId: "old" }))[0];
		await taskRuns.markRetrying(
			run.id,
			{ code: "manual" },
			"2026-06-04T00:00:00.000Z",
		);
		const current = (await taskRuns.claimRunnable({ workerId: "new" }))[0];
		expect(current.claimToken).not.toBe(first.claimToken);
		expect(
			(await taskRuns.updateProgress(run.id, { wrong: true }, first.claimToken))
				.applied,
		).toBe(false);
		expect(
			await eventLogs.append({
				taskRunId: run.id,
				claimToken: first.claimToken,
				eventType: "old",
				level: "info",
				message: "old",
			}),
		).toBeNull();
		expect(
			(await taskRuns.markFailed(run.id, { wrong: true }, first.claimToken))
				.applied,
		).toBe(false);
		const attempts = await Promise.all(
			[1, 2].map(() =>
				taskRuns.markFailed(run.id, { code: "FAILED" }, current.claimToken),
			),
		);
		expect(attempts.filter((result) => result.applied)).toHaveLength(1);
		expect(await taskRuns.getRequired(run.id)).toMatchObject({
			status: "failed",
			attempts: 2,
			claimToken: current.claimToken,
			error: { code: "FAILED" },
		});
	});

	it("skips a busy concurrency key without waiting and excludes a retrying run from its own lock", async () => {
		const fixture = await createFixture();
		const key = "busy-bucket";
		const run = await fixture.taskRuns.create({
			type: "lock",
			category: "maintenance",
			payload: {},
			concurrencyKey: key,
		});
		let release!: () => void;
		let ready!: () => void;
		const acquired = new Promise<void>((resolve) => {
			ready = resolve;
		});
		const lock = fixture.db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(${advisoryLockKey("task-concurrency", key)}::bigint)`,
			);
			ready();
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		});
		await acquired;
		try {
			expect(
				await fixture.taskRuns.claimRunnable({ workerId: "poll" }),
			).toEqual([]);
		} finally {
			release();
			await lock;
		}
		await fixture.taskRuns.markRetrying(run.id, {}, "2026-06-04T00:00:00.000Z");
		const claims = await fixture.taskRuns.claimRunnable({ workerId: "retry" });
		expect(claims.map((task) => task.id)).toEqual([run.id]);
	});

	it("atomically creates task, delivery, and first event across an idempotency race", async () => {
		const fixture = await createFixture();
		const input = {
			task: { type: "mail", payload: {}, idempotencyKey: "same-mail" },
			delivery: {
				channel: "email",
				recipientType: "test" as const,
				recipientAddressSnapshot: "a@example.test",
				recipientIdentityKey: "a",
				eventFamily: "test",
				templateKey: "test",
			},
		};
		const created = await Promise.all(
			[1, 2].map(() =>
				fixture.taskRuns.createNotificationTaskWithDelivery(input),
			),
		);
		expect(created.filter((result) => result.created)).toHaveLength(1);
		expect(new Set(created.map((result) => result.task.id)).size).toBe(1);
		expect(await fixture.db.select().from(notificationDeliveries)).toHaveLength(
			1,
		);
		expect(await fixture.db.select().from(taskEventLogs)).toHaveLength(1);
	});

	it("rolls back delivery writes on relationship failure and fences notification completion replay", async () => {
		const fixture = await createFixture();
		const create = (key: string) =>
			fixture.taskRuns.createNotificationTaskWithDelivery({
				task: { type: "mail", payload: {}, idempotencyKey: key },
				delivery: {
					channel: "email",
					recipientType: "test",
					recipientAddressSnapshot: "a@example.test",
					recipientIdentityKey: key,
					eventFamily: "test",
					templateKey: "test",
				},
			});
		const first = await create("first"),
			other = await create("other");
		const claimed = await fixture.taskRuns.markRunning(first.task.id);
		if (!claimed || !first.delivery || !other.delivery)
			throw new Error("Expected claimed task and deliveries");
		const sentAt = "2026-06-04T10:00:00.000Z";
		await expect(
			fixture.taskRuns.completeNotificationAttempt({
				taskId: first.task.id,
				claimToken: claimed.claimToken,
				outcomes: [
					{ deliveryId: first.delivery.id, status: "sent", sentAt },
					{ deliveryId: other.delivery.id, status: "sent", sentAt },
				],
				next: { status: "succeeded", result: {} },
				events: [],
			}),
		).rejects.toThrow("does not belong");
		expect(
			await fixture.taskRuns.getDeliveryRequired(first.delivery.id),
		).toMatchObject({ status: "queued", sentAt: null });
		expect(await fixture.taskRuns.getRequired(first.task.id)).toMatchObject({
			status: "running",
			attempts: 0,
		});
		const complete = () =>
			fixture.taskRuns.completeNotificationAttempt({
				taskId: first.task.id,
				claimToken: claimed.claimToken,
				outcomes: [
					{ deliveryId: first.delivery.id, status: "sent" as const, sentAt },
				],
				next: { status: "succeeded", result: { sent: 1 } },
				events: [{ eventType: "accepted", level: "info", message: "accepted" }],
			});
		const results = await Promise.all([complete(), complete()]);
		expect(results.filter((result) => result.applied)).toHaveLength(1);
		expect(await fixture.taskRuns.getRequired(first.task.id)).toMatchObject({
			status: "succeeded",
			attempts: 1,
		});
		const events = await fixture.eventLogs.listForRun({
			taskRunId: first.task.id,
			limit: 20,
			offset: 0,
			includePrivate: true,
		});
		expect(events.items.map((event) => event.eventType)).toEqual([
			"notification.email.queued",
			"accepted",
		]);
	});

	it("does not expire a fresh heartbeat and invalidates a cancelled or expired claim", async () => {
		const { taskRuns, eventLogs } = await createFixture();
		const run = await taskRuns.create({
			type: "stale",
			category: "maintenance",
			payload: {},
		});
		const [claim] = await taskRuns.claimRunnable({
			workerId: "lease",
			nowIso: "2026-06-04T09:00:00.000Z",
		});
		await taskRuns.updateProgress(
			run.id,
			{ heartbeat: "fresh" },
			claim.claimToken,
		);
		expect(
			await taskRuns.expireStale(claim, "2026-06-04T09:30:00.000Z", {}),
		).toBeNull();
		await taskRuns.cancel(run.id, {});
		expect(
			(await taskRuns.markSucceeded(run.id, { wrong: true }, claim.claimToken))
				.applied,
		).toBe(false);
		expect(
			await eventLogs.append({
				taskRunId: run.id,
				claimToken: claim.claimToken,
				eventType: "late",
				level: "info",
				message: "late",
			}),
		).toBeNull();
		await taskRuns.markRetrying(run.id, {}, "2026-06-04T00:00:00.000Z");
		const [old] = await taskRuns.claimRunnable({
			workerId: "old",
			nowIso: "2026-06-04T09:00:00.000Z",
		});
		expect(
			await taskRuns.expireStale(old, "2026-06-04T09:30:00.000Z", {
				code: "STALE",
			}),
		).toMatchObject({ status: "failed", claimToken: null, attempts: 2 });
		expect(
			(await taskRuns.markSucceeded(run.id, {}, old.claimToken)).applied,
		).toBe(false);
	});
});
