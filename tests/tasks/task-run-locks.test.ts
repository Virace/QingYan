import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { adminUsers, sites } from "../../src/db/schema";
import { ScheduledTaskRepository } from "../../src/modules/tasks/scheduled-task-repository";
import { TaskEventLogRepository } from "../../src/modules/tasks/task-event-log-repository";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import { TaskScheduler } from "../../src/modules/tasks/scheduler";
import {
	applyInitialMigration,
	createTestWorkspace,
	type TestWorkspace,
} from "../support/test-fixtures";

interface Fixture {
	workspace: TestWorkspace;
	sqlite: ReturnType<typeof createDatabaseClients>["sqlite"];
	scheduledTasks: ScheduledTaskRepository;
	taskRuns: TaskRunRepository;
	eventLogs: TaskEventLogRepository;
	scheduler: TaskScheduler;
	siteId: number;
	adminUserId: number;
}

const fixtures: Fixture[] = [];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		fixture.sqlite.close();
		fixture.workspace.cleanup();
	}
});

async function createFixture(): Promise<Fixture> {
	const workspace = createTestWorkspace("qingyan-task-run-locks-");
	applyInitialMigration(workspace.databaseFile);
	const clients = createDatabaseClients(workspace.databaseFile);
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
		sqlite: clients.sqlite,
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
});
