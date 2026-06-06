import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createDatabaseClients } from "../../src/db/client";
import { adminUsers, siteSettings, sites } from "../../src/db/schema";
import type { SiteRegistry } from "../../src/modules/shared/site-registry";
import { createBuiltInTaskTypeRegistry } from "../../src/modules/tasks/built-in-task-types";
import { PageSourceRefreshPolicyService } from "../../src/modules/tasks/page-source-refresh-policy";
import { ScheduledTaskRepository } from "../../src/modules/tasks/scheduled-task-repository";
import { authoritativePageSourceRefreshSystemKey } from "../../src/modules/tasks/system-managed-task-service";
import { TaskEventLogRepository } from "../../src/modules/tasks/task-event-log-repository";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import {
	TaskRunCancelledError,
	TaskRunner,
	TaskRunSuppressedError,
} from "../../src/modules/tasks/task-runner";
import {
	type TaskTypePermissions,
	TaskTypeRegistry,
} from "../../src/modules/tasks/task-type-registry";
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
	const workspace = createTestWorkspace("qingyan-task-runner-status-");
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
		eventLogs: new TaskEventLogRepository(clients.db),
		siteId: site.id,
		adminUserId: adminUser.id,
	};
	fixtures.push(fixture);
	return fixture;
}

async function createRun(fixture: Fixture, type: string) {
	const task = await fixture.scheduledTasks.create({
		name: type,
		type,
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
	});
}

function createDefinition(input: {
	type: string;
	precondition?: "ok" | "skipped" | "blocked";
	run: () => Promise<unknown>;
}) {
	const permissions: TaskTypePermissions = {
		read: "tasks.read",
		create: "tasks.schedule.create",
		run: "tasks.run",
		update: "tasks.schedule.update",
		delete: "tasks.schedule.delete",
	};
	return {
		type: input.type,
		label: input.type,
		description: input.type,
		category: "maintenance" as const,
		scope: "site" as const,
		permissions,
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
			file: "tests/tasks/task-runner-status.test.ts",
		},
		precondition: input.precondition
			? async () => input.precondition ?? "ok"
			: undefined,
		run: input.run,
	};
}

describe("TaskRunner status mapping", () => {
	it("maps preconditions and runner outcomes to distinct run statuses", async () => {
		const fixture = await createFixture();
		const registry = new TaskTypeRegistry([
			createDefinition({
				type: "test_succeeded",
				run: async () => ({ ok: true }),
			}),
			createDefinition({
				type: "test_failed",
				run: async () => {
					throw new Error("domain failure");
				},
			}),
			createDefinition({
				type: "test_skipped",
				precondition: "skipped",
				run: async () => ({ unreachable: true }),
			}),
			createDefinition({
				type: "test_blocked",
				precondition: "blocked",
				run: async () => ({ unreachable: true }),
			}),
			createDefinition({
				type: "test_cancelled",
				run: async () => {
					throw new TaskRunCancelledError("cancel requested");
				},
			}),
			createDefinition({
				type: "test_suppressed",
				run: async () => {
					throw new TaskRunSuppressedError("quiet window");
				},
			}),
		]);
		const runner = new TaskRunner({
			registry,
			taskRuns: fixture.taskRuns,
			eventLogs: fixture.eventLogs,
			workerId: "worker-a",
		});
		const runs = await Promise.all(
			[
				"test_succeeded",
				"test_failed",
				"test_skipped",
				"test_blocked",
				"test_cancelled",
				"test_suppressed",
			].map((type) => createRun(fixture, type)),
		);

		for (const run of runs) {
			await runner.run(run.id);
		}
		const saved = await Promise.all(
			runs.map((run) => fixture.taskRuns.getRequired(run.id)),
		);

		expect(saved.map((run) => run.status)).toEqual([
			"succeeded",
			"failed",
			"skipped",
			"blocked",
			"cancelled",
			"suppressed",
		]);
		expect(saved[0]?.result).toEqual({ ok: true });
		expect(saved[1]?.error).toMatchObject({ code: "TASK_RUN_FAILED" });
		expect(saved[2]?.skipReason).toBe("precondition_skipped");
		expect(saved[3]?.blockReason).toBe("precondition_blocked");
		expect(saved[4]?.error).toMatchObject({ code: "TASK_RUN_CANCELLED" });
		expect(saved[5]?.error).toMatchObject({ code: "TASK_RUN_SUPPRESSED" });
	});

	it("blocks ordinary page source refresh runs while authoritative mode owns the site", async () => {
		const fixture = await createFixture();
		const ordinaryTask = await fixture.scheduledTasks.create({
			name: "Ordinary page source refresh",
			type: "page_source_refresh",
			siteId: fixture.siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "manual_only",
			payload: {
				siteKey: "fangyuan",
				sitemapUrls: ["http://localhost:4321/sitemap.xml"],
				mode: "replace",
			},
			policy: {},
			trigger: { kind: "manual" },
			retentionCount: 5,
			ownerUserId: fixture.adminUserId,
			createdByUserId: fixture.adminUserId,
			updatedByUserId: fixture.adminUserId,
		});
		const systemTask = await fixture.scheduledTasks.create({
			name: "System page source refresh",
			type: "page_source_refresh",
			siteId: fixture.siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "manual_only",
			payload: {
				siteKey: "fangyuan",
				sitemapUrls: ["http://localhost:4321/sitemap.xml"],
				mode: "replace",
			},
			systemKey: authoritativePageSourceRefreshSystemKey("fangyuan"),
			policy: {},
			trigger: { kind: "manual" },
			retentionCount: 5,
			ownerUserId: fixture.adminUserId,
			createdByUserId: fixture.adminUserId,
			updatedByUserId: fixture.adminUserId,
		});
		await fixture.db.insert(siteSettings).values({
			siteId: fixture.siteId,
			pageRegistryJson: JSON.stringify({
				mode: "authoritative",
				authoritativeSitemapUrls: ["http://localhost:4321/sitemap.xml"],
			}),
		});
		const ordinaryRun = await fixture.taskRuns.createScheduledTaskRun({
			scheduledTask: ordinaryTask,
			trigger: "schedule",
			triggerSnapshot: {},
			input: {
				siteKey: "fangyuan",
				sitemapUrls: ["http://localhost:4321/sitemap.xml"],
				mode: "replace",
			},
		});
		const systemRun = await fixture.taskRuns.createScheduledTaskRun({
			scheduledTask: systemTask,
			trigger: "schedule",
			triggerSnapshot: {},
			input: systemTask.payload,
		});
		const pageSourceRefresh = {
			executeRefresh: vi.fn().mockResolvedValue({ processed: 1 }),
		};
		const runner = new TaskRunner({
			registry: createBuiltInTaskTypeRegistry(),
			taskRuns: fixture.taskRuns,
			scheduledTasks: fixture.scheduledTasks,
			eventLogs: fixture.eventLogs,
			workerId: "worker-a",
			services: {
				pageSourceRefresh,
				pageSourceRefreshPolicy: new PageSourceRefreshPolicyService(
					fixture.db,
					{
						getRegisteredSite: () => ({
							id: fixture.siteId,
							siteKey: "fangyuan",
							name: "FangYuan",
							allowedOrigins: ["http://localhost:4321"],
						}),
						listRegisteredSites: () => [],
					} as unknown as SiteRegistry,
				),
			},
		});

		await runner.run(ordinaryRun.id);
		await runner.run(systemRun.id);

		const blocked = await fixture.taskRuns.getRequired(ordinaryRun.id);
		const succeeded = await fixture.taskRuns.getRequired(systemRun.id);
		expect(blocked.status).toBe("blocked");
		expect(blocked.blockReason).toBe("precondition_blocked");
		expect(succeeded.status).toBe("succeeded");
		expect(pageSourceRefresh.executeRefresh).toHaveBeenCalledTimes(1);
	});
});
