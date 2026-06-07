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
	db: ReturnType<typeof createDatabaseClients>["db"];
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
	const workspace = createTestWorkspace("qingyan-task-scheduler-");
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
		db: clients.db,
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

describe("TaskScheduler", () => {
	it("does not create runs after graceful stop", async () => {
		const { scheduledTasks, taskRuns, scheduler, siteId, adminUserId } =
			await createFixture();
		await scheduledTasks.create({
			name: "Stopped scheduler task",
			type: "page_source_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "interval",
			payload: { siteKey: "fangyuan" },
			policy: {},
			trigger: { everyMinutes: 30 },
			nextRunAt: "2026-06-04T10:00:00.000Z",
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});

		scheduler.stop();
		const result = await scheduler.tick({
			now: new Date("2026-06-04T10:00:00.000Z"),
		});
		const runs = await taskRuns.listForTaskCenter({
			category: "maintenance",
			limit: 10,
			offset: 0,
		});

		expect(result.createdRunIds).toEqual([]);
		expect(runs.totalCount).toBe(0);
	});

	it("creates a single due run, snapshots the task, and advances nextRunAt", async () => {
		const { scheduledTasks, taskRuns, scheduler, siteId, adminUserId } =
			await createFixture();
		const task = await scheduledTasks.create({
			name: "Refresh FangYuan sources",
			type: "page_source_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "interval",
			payload: {
				siteKey: "fangyuan",
				sitemapUrls: ["https://example.com/sitemap.xml"],
			},
			policy: {},
			trigger: { everyMinutes: 30 },
			nextRunAt: "2026-06-04T10:00:00.000Z",
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});

		const firstTick = await scheduler.tick({
			now: new Date("2026-06-04T10:00:00.000Z"),
		});
		const secondTick = await scheduler.tick({
			now: new Date("2026-06-04T10:00:00.000Z"),
		});
		const updatedTask = await scheduledTasks.getRequired(task.id);
		const runs = await taskRuns.listForTaskCenter({
			category: "maintenance",
			limit: 10,
			offset: 0,
		});

		expect(firstTick.createdRunIds).toHaveLength(1);
		expect(secondTick.createdRunIds).toHaveLength(0);
		expect(runs.totalCount).toBe(1);
		expect(runs.items[0]).toMatchObject({
			id: firstTick.createdRunIds[0],
			scheduledTaskId: task.id,
			scheduledTaskNameSnapshot: "Refresh FangYuan sources",
			type: "page_source_refresh",
			status: "queued",
			trigger: "schedule",
			triggerSnapshot: { dueAt: "2026-06-04T10:00:00.000Z" },
			input: {
				siteKey: "fangyuan",
				sitemapUrls: ["https://example.com/sitemap.xml"],
			},
			concurrencyKey: 'task:page_source_refresh:site:{"siteKey":"fangyuan"}',
		});
		expect(updatedTask).toMatchObject({
			lastRunId: firstTick.createdRunIds[0],
			lastRunAt: "2026-06-04T10:00:00.000Z",
			lastStatus: "queued",
			nextRunAt: "2026-06-04T10:30:00.000Z",
		});
	});

	it("disables once tasks after their due run is created", async () => {
		const { scheduledTasks, scheduler, siteId, adminUserId } =
			await createFixture();
		const task = await scheduledTasks.create({
			name: "One-shot title refresh",
			type: "page_metadata_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "once",
			payload: { siteKey: "fangyuan", scope: "missing_only" },
			policy: {},
			trigger: { runAt: "2026-06-04T10:00:00.000Z" },
			nextRunAt: "2026-06-04T10:00:00.000Z",
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});

		await scheduler.tick({ now: new Date("2026-06-04T10:00:00.000Z") });
		const updatedTask = await scheduledTasks.getRequired(task.id);

		expect(updatedTask.enabled).toBe(false);
		expect(updatedTask.disabledReason).toBe("once_completed");
		expect(updatedTask.nextRunAt).toBeNull();
	});

	it("claims a due task before creating the run so concurrent schedulers do not duplicate it", async () => {
		const { scheduledTasks, taskRuns, eventLogs, siteId, adminUserId } =
			await createFixture();
		const firstScheduler = new TaskScheduler({
			scheduledTasks,
			taskRuns,
			eventLogs,
			workerId: "worker-a",
		});
		const secondScheduler = new TaskScheduler({
			scheduledTasks,
			taskRuns,
			eventLogs,
			workerId: "worker-b",
		});
		await scheduledTasks.create({
			name: "Refresh page metadata",
			type: "page_metadata_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "interval",
			payload: { siteKey: "fangyuan", scope: "missing_only" },
			policy: {},
			trigger: { everyMinutes: 30 },
			nextRunAt: "2026-06-04T10:00:00.000Z",
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});

		const [firstTick, secondTick] = await Promise.all([
			firstScheduler.tick({ now: new Date("2026-06-04T10:00:00.000Z") }),
			secondScheduler.tick({ now: new Date("2026-06-04T10:00:00.000Z") }),
		]);
		const runs = await taskRuns.listForTaskCenter({
			category: "maintenance",
			limit: 10,
			offset: 0,
		});

		expect([
			...firstTick.createdRunIds,
			...secondTick.createdRunIds,
		]).toHaveLength(1);
		expect(runs.totalCount).toBe(1);
	});
});
