import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { buildApp } from "../../src/app";
import { createDatabaseClients } from "../../src/db/client";
import { adminUsers, sites } from "../../src/db/schema";
import { ScheduledTaskRepository } from "../../src/modules/tasks/scheduled-task-repository";
import { TaskEventLogRepository } from "../../src/modules/tasks/task-event-log-repository";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import { TaskRunWorker } from "../../src/modules/tasks/task-run-worker";
import { TaskRunner } from "../../src/modules/tasks/task-runner";
import { TaskTypeRegistry } from "../../src/modules/tasks/task-type-registry";
import {
	applyInitialMigration,
	createTestConfig,
	createTestWorkspace,
	type TestWorkspace,
} from "../support/test-fixtures";

interface Fixture {
	workspace: TestWorkspace;
	sqlite: ReturnType<typeof createDatabaseClients>["sqlite"];
	scheduledTasks: ScheduledTaskRepository;
	taskRuns: TaskRunRepository;
	eventLogs: TaskEventLogRepository;
	siteId: number;
	adminUserId: number;
}

const fixtures: Fixture[] = [];
const asyncCleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of asyncCleanups.splice(0)) {
		await cleanup();
	}
	for (const fixture of fixtures.splice(0)) {
		fixture.sqlite.close();
		fixture.workspace.cleanup();
	}
});

async function createFixture(): Promise<Fixture> {
	const workspace = createTestWorkspace("qingyan-task-run-worker-");
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
		sqlite: clients.sqlite,
		scheduledTasks: new ScheduledTaskRepository(clients.db),
		taskRuns: new TaskRunRepository(clients.db),
		eventLogs: new TaskEventLogRepository(clients.db),
		siteId: site.id,
		adminUserId: adminUser.id,
	};
	fixtures.push(fixture);
	return fixture;
}

async function createRun(
	fixture: Fixture,
	input: { type?: string; runAfter?: string | null } = {},
) {
	const task = await fixture.scheduledTasks.create({
		name: input.type ?? "worker_test",
		type: input.type ?? "worker_test",
		siteId: fixture.siteId,
		scopeKind: "site",
		scope: { siteKey: "fangyuan" },
		enabled: true,
		scheduleKind: "manual_only",
		payload: { siteKey: "fangyuan" },
		policy: {},
		trigger: { kind: "manual" },
		retentionCount: 5,
		ownerUserId: fixture.adminUserId,
		createdByUserId: fixture.adminUserId,
		updatedByUserId: fixture.adminUserId,
	});
	return fixture.taskRuns.createScheduledTaskRun({
		scheduledTask: task,
		trigger: "manual",
		triggerSnapshot: {},
		input: task.payload,
		runAfter: input.runAfter,
		createdAt: "2026-06-04T10:00:00.000Z",
		updatedAt: "2026-06-04T10:00:00.000Z",
	});
}

function createRegistry() {
	return new TaskTypeRegistry([
		{
			type: "worker_test",
			label: "worker_test",
			description: "worker_test",
			category: "maintenance",
			scope: "site",
			permissions: {
				read: "tasks.read",
				create: "tasks.schedule.create",
				run: "tasks.run",
				update: "tasks.schedule.update",
				delete: "tasks.schedule.delete",
			},
			payloadSchema: z.object({ siteKey: z.string() }),
			defaultPayload: { siteKey: "fangyuan" },
			defaultPolicy: { maxAttempts: 1, retryDelaySec: 0 },
			schedule: {
				manual: true,
				presets: [],
				cron: false,
				condition: false,
			},
			reuse: {
				service: "TestService",
				method: "run",
				file: "tests/tasks/task-run-worker.test.ts",
			},
			run: async (_payload, context) => {
				await context.writeEvent({
					eventType: "worker_test_executed",
					message: "worker_test_executed",
					visibleToSiteAdmin: true,
				});
				await context.log.system("Worker test started.");
				await context.log.stdout("Processed one item.", { count: 1 });
				await context.log.stderr("Worker test warning.", { code: "WARN" });
				return { ok: true };
			},
		},
	]);
}

function createWorker(fixture: Fixture) {
	const runner = new TaskRunner({
		registry: createRegistry(),
		taskRuns: fixture.taskRuns,
		eventLogs: fixture.eventLogs,
		workerId: "task-worker:test",
	});
	return new TaskRunWorker({
		taskRuns: fixture.taskRuns,
		runner,
		workerId: "task-worker:test",
		claimLimit: 5,
		now: () => new Date("2026-06-04T10:00:00.000Z"),
	});
}

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRunStatus(
	taskRuns: TaskRunRepository,
	runId: string,
	predicate: (status: string) => boolean,
) {
	const deadline = Date.now() + 2000;
	let current = await taskRuns.getRequired(runId);
	while (!predicate(current.status)) {
		if (Date.now() > deadline) {
			throw new Error(
				`Timed out waiting for run status, got ${current.status}.`,
			);
		}
		await delay(25);
		current = await taskRuns.getRequired(runId);
	}
	return current;
}

describe("TaskRunWorker", () => {
	it("claims due queued runs and executes them with the task runner", async () => {
		const fixture = await createFixture();
		const run = await createRun(fixture);
		const worker = createWorker(fixture);

		const result = await worker.tick();
		const saved = await fixture.taskRuns.getRequired(run.id);
		const events = await fixture.eventLogs.listForRun({
			taskRunId: run.id,
			limit: 10,
			offset: 0,
			includePrivate: true,
		});

		expect(result).toEqual({ claimedRunIds: [run.id] });
		expect(saved).toMatchObject({
			status: "succeeded",
			workerId: "task-worker:test",
			result: { ok: true },
		});
		expect(saved.startedAt).not.toBeNull();
		expect(saved.finishedAt).not.toBeNull();
		expect(events.items.map((event) => event.eventType)).toContain(
			"worker_test_executed",
		);
		expect(events.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					sequence: 2,
					stream: "system",
					message: "Worker test started.",
				}),
				expect.objectContaining({
					sequence: 3,
					stream: "stdout",
					message: "Processed one item.",
				}),
				expect.objectContaining({
					sequence: 4,
					stream: "stderr",
					level: "warn",
					message: "Worker test warning.",
				}),
			]),
		);
	});

	it("does not claim delayed runs before runAfter", async () => {
		const fixture = await createFixture();
		const run = await createRun(fixture, {
			runAfter: "2026-06-04T10:30:00.000Z",
		});
		const worker = createWorker(fixture);

		const result = await worker.tick();
		const saved = await fixture.taskRuns.getRequired(run.id);

		expect(result).toEqual({ claimedRunIds: [] });
		expect(saved.status).toBe("delayed");
		expect(saved.startedAt).toBeNull();
	});

	it("does not claim runs after graceful stop", async () => {
		const fixture = await createFixture();
		const run = await createRun(fixture);
		const worker = createWorker(fixture);

		worker.stop();
		const result = await worker.tick();
		const saved = await fixture.taskRuns.getRequired(run.id);

		expect(result).toEqual({ claimedRunIds: [] });
		expect(saved.status).toBe("queued");
	});

	it("starts with the application and consumes queued scheduled task runs", async () => {
		const workspace = createTestWorkspace("qingyan-task-worker-startup-");
		applyInitialMigration(workspace.databaseFile);
		const clients = createDatabaseClients(workspace.databaseFile);
		let runId = "";
		try {
			await clients.db.insert(sites).values({
				siteKey: "fangyuan",
				name: "FangYuan",
				allowedOriginsJson: '["http://localhost:4321"]',
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
			const task = await scheduledTasks.create({
				name: "Startup title refresh",
				type: "page_metadata_refresh",
				siteId: site.id,
				scopeKind: "site",
				scope: { siteKey: "fangyuan" },
				enabled: true,
				scheduleKind: "manual_only",
				payload: { siteKey: "fangyuan", scope: "missing_only" },
				policy: {},
				trigger: { kind: "manual" },
				retentionCount: 5,
				ownerUserId: adminUser.id,
				createdByUserId: adminUser.id,
				updatedByUserId: adminUser.id,
			});
			const run = await taskRuns.createScheduledTaskRun({
				scheduledTask: task,
				trigger: "manual",
				triggerSnapshot: {},
				input: task.payload,
			});
			runId = run.id;
		} finally {
			clients.sqlite.close();
		}

		const app = await buildApp(createTestConfig(workspace.databaseFile));
		asyncCleanups.push(async () => {
			await app.close();
			workspace.cleanup();
		});
		const taskRuns = new TaskRunRepository(app.db);

		const saved = await waitForRunStatus(
			taskRuns,
			runId,
			(status) => status !== "queued" && status !== "running",
		);

		expect(saved).toMatchObject({
			status: "succeeded",
			workerId: expect.stringMatching(/^task-worker:/),
			result: expect.objectContaining({
				processed: 0,
				updated: 0,
				failed: 0,
			}),
		});
	});
});
