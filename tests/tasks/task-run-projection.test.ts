import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { adminUsers, sites } from "../../src/db/schema";
import { ScheduledTaskRepository } from "../../src/modules/tasks/scheduled-task-repository";
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
	scheduledTasks: ScheduledTaskRepository;
	taskRuns: TaskRunRepository;
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
	const workspace = createTestWorkspace("qingyan-task-run-projection-");
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
	const fixture = {
		workspace,
		db: clients.db,
		sqlite: clients.sqlite,
		scheduledTasks: new ScheduledTaskRepository(clients.db),
		taskRuns: new TaskRunRepository(clients.db),
		siteId: site.id,
		adminUserId: adminUser.id,
	};
	fixtures.push(fixture);
	return fixture;
}

describe("scheduled task run projection", () => {
	it("keeps definition snapshots after scheduled task update and delete", async () => {
		const { scheduledTasks, taskRuns, siteId, adminUserId } =
			await createFixture();
		const task = await scheduledTasks.create({
			name: "Original source refresh",
			type: "page_source_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "manual_only",
			payload: { sourceIds: [1] },
			policy: { maxAttempts: 2, retryDelaySec: 120 },
			trigger: { kind: "manual" },
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});

		const run = await taskRuns.createScheduledTaskRun({
			scheduledTask: task,
			trigger: "manual",
			triggerSnapshot: { actor: "admin" },
			input: { sourceIds: [1] },
			createdByUserId: adminUserId,
			runAfter: "2026-06-04T10:00:00.000Z",
		});
		await scheduledTasks.update(task.id, {
			name: "Updated source refresh",
			payload: { sourceIds: [2] },
			updatedByUserId: adminUserId,
		});
		await scheduledTasks.deleteWithSnapshot(task.id, {
			deletedByUserId: adminUserId,
			deleteReason: "retired",
		});
		const savedRun = await taskRuns.getRequired(run.id);

		expect(savedRun).toMatchObject({
			scheduledTaskId: task.id,
			scheduledTaskNameSnapshot: "Original source refresh",
			type: "page_source_refresh",
			category: "maintenance",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			trigger: "manual",
			triggerSnapshot: { actor: "admin" },
			input: { sourceIds: [1] },
			actionConfigSnapshot: {
				payload: { sourceIds: [1] },
				policy: { maxAttempts: 2, retryDelaySec: 120 },
			},
			ownerUserIdSnapshot: adminUserId,
			createdByUserId: adminUserId,
		});
	});

	it("records progress, skipped, blocked, and lock-conflict fields", async () => {
		const { scheduledTasks, taskRuns, siteId, adminUserId } =
			await createFixture();
		const task = await scheduledTasks.create({
			name: "Refresh titles",
			type: "page_metadata_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "manual_only",
			payload: { scope: "missing_only" },
			policy: {},
			trigger: { kind: "manual" },
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});

		const run = await taskRuns.createScheduledTaskRun({
			scheduledTask: task,
			trigger: "schedule",
			triggerSnapshot: { dueAt: "2026-06-04T10:00:00.000Z" },
			input: { scope: "missing_only" },
			createdByUserId: adminUserId,
		});
		await taskRuns.updateProgress(run.id, { scanned: 10 });
		await taskRuns.markSkipped(run.id, "no_target_pages", {
			pageCount: 0,
		});
		const skipped = await taskRuns.getRequired(run.id);

		const blockedRun = await taskRuns.createScheduledTaskRun({
			scheduledTask: task,
			trigger: "schedule",
			triggerSnapshot: {},
			input: {},
			createdByUserId: adminUserId,
		});
		await taskRuns.markBlocked(blockedRun.id, "smtp_not_configured", {
			code: "SMTP_NOT_CONFIGURED",
		});
		const blocked = await taskRuns.getRequired(blockedRun.id);

		const lockConflict = await taskRuns.recordLockConflict({
			scheduledTask: task,
			trigger: "schedule",
			triggerSnapshot: {},
			input: {},
			createdByUserId: adminUserId,
			conflictWithRunId: run.id,
			conflictWithTaskName: "Refresh titles",
			concurrencyKey: "site:fangyuan:title-refresh",
		});

		expect(skipped).toMatchObject({
			status: "skipped",
			progress: { scanned: 10 },
			skipReason: "no_target_pages",
			result: { pageCount: 0 },
		});
		expect(blocked).toMatchObject({
			status: "blocked",
			blockReason: "smtp_not_configured",
			error: { code: "SMTP_NOT_CONFIGURED" },
		});
		expect(lockConflict).toMatchObject({
			status: "failed",
			error: { code: "TASK_LOCK_CONFLICT" },
			lockConflictWithRunId: run.id,
			lockConflictWithTaskName: "Refresh titles",
			concurrencyKey: "site:fangyuan:title-refresh",
		});
	});
});
