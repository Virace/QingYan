import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { adminUsers, sites } from "../../src/db/schema";
import { ConditionTriggerEvaluator } from "../../src/modules/tasks/condition-trigger-evaluator";
import { ScheduledTaskRepository } from "../../src/modules/tasks/scheduled-task-repository";
import { TaskEventLogRepository } from "../../src/modules/tasks/task-event-log-repository";
import { TaskMetricRollupRepository } from "../../src/modules/tasks/task-metric-rollup-repository";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import { TaskScheduler } from "../../src/modules/tasks/scheduler";
import {
	applyInitialMigration,
	createTestApp,
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
	rollups: TaskMetricRollupRepository;
	scheduler: TaskScheduler;
	siteId: number;
	adminUserId: number;
}

const fixtures: Fixture[] = [];
const cleanupCallbacks: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	for (const cleanup of cleanupCallbacks.splice(0).reverse()) {
		await cleanup();
	}
	for (const fixture of fixtures.splice(0)) {
		fixture.sqlite.close();
		fixture.workspace.cleanup();
	}
});

async function createFixture(): Promise<Fixture> {
	const workspace = createTestWorkspace("qingyan-condition-trigger-");
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
	const rollups = new TaskMetricRollupRepository(clients.db);
	const fixture = {
		workspace,
		db: clients.db,
		sqlite: clients.sqlite,
		scheduledTasks,
		taskRuns,
		eventLogs,
		rollups,
		scheduler: new TaskScheduler({
			scheduledTasks,
			taskRuns,
			eventLogs,
			workerId: "worker-a",
			conditionEvaluator: new ConditionTriggerEvaluator(rollups),
		}),
		siteId: site.id,
		adminUserId: adminUser.id,
	};
	fixtures.push(fixture);
	return fixture;
}

function conditionTrigger(
	expression: unknown,
	extra?: Record<string, unknown>,
) {
	return {
		condition: {
			enabled: true,
			evaluationIntervalSec: 300,
			expression,
			...extra,
		},
	};
}

describe("ConditionTriggerEvaluator", () => {
	it("evaluates metric comparisons with and/or/not expressions", async () => {
		const { scheduledTasks, rollups, siteId, adminUserId } =
			await createFixture();
		await rollups.increment({
			siteKey: "fangyuan",
			metricKey: "request.failed",
			value: 6,
			at: new Date("2026-06-04T10:00:00.000Z"),
		});
		await rollups.increment({
			siteKey: "fangyuan",
			metricKey: "request.rate_limited",
			value: 1,
			at: new Date("2026-06-04T10:00:00.000Z"),
		});
		const task = await scheduledTasks.create({
			name: "Refresh titles when failures spike",
			type: "page_metadata_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "condition",
			payload: { siteKey: "fangyuan", scope: "missing_only" },
			policy: {},
			trigger: conditionTrigger({
				op: "and",
				expressions: [
					{
						op: "metric",
						metricKey: "request.failed",
						comparator: ">=",
						threshold: 5,
						windowSec: 300,
					},
					{
						op: "or",
						expressions: [
							{
								op: "metric",
								metricKey: "request.rate_limited",
								comparator: ">",
								threshold: 3,
								windowSec: 300,
							},
							{
								op: "not",
								expression: {
									op: "metric",
									metricKey: "request.rate_limited",
									comparator: ">",
									threshold: 3,
									windowSec: 300,
								},
							},
						],
					},
				],
			}),
			nextRunAt: "2026-06-04T10:00:00.000Z",
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});

		const result = await new ConditionTriggerEvaluator(rollups).evaluate(task, {
			now: new Date("2026-06-04T10:00:00.000Z"),
		});

		expect(result).toMatchObject({
			status: "hit",
			hit: true,
			snapshot: {
				values: [
					expect.objectContaining({
						metricKey: "request.failed",
						value: 6,
						hit: true,
					}),
					expect.objectContaining({
						metricKey: "request.rate_limited",
						value: 1,
						hit: false,
					}),
					expect.objectContaining({
						metricKey: "request.rate_limited",
						value: 1,
						hit: false,
					}),
				],
			},
		});
	});

	it("rejects unknown metrics and script-like expression nodes", async () => {
		const { scheduledTasks, rollups, siteId, adminUserId } =
			await createFixture();
		const evaluator = new ConditionTriggerEvaluator(rollups);
		const unknownMetricTask = await scheduledTasks.create({
			name: "Unknown metric",
			type: "page_source_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "condition",
			payload: {
				siteKey: "fangyuan",
				sitemapUrls: ["https://example.com/sitemap.xml"],
			},
			policy: {},
			trigger: conditionTrigger({
				op: "metric",
				metricKey: "raw.sql.count",
				comparator: ">",
				threshold: 0,
				windowSec: 60,
			}),
			nextRunAt: "2026-06-04T10:00:00.000Z",
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});
		const scriptTask = await scheduledTasks.create({
			name: "Script expression",
			type: "page_source_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "condition",
			payload: {
				siteKey: "fangyuan",
				sitemapUrls: ["https://example.com/sitemap.xml"],
			},
			policy: {},
			trigger: conditionTrigger({
				op: "script",
				source: "return true",
			}),
			nextRunAt: "2026-06-04T10:00:00.000Z",
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});

		await expect(
			evaluator.evaluate(unknownMetricTask, {
				now: new Date("2026-06-04T10:00:00.000Z"),
			}),
		).resolves.toMatchObject({ status: "invalid_metric", hit: false });
		await expect(
			evaluator.evaluate(scriptTask, {
				now: new Date("2026-06-04T10:00:00.000Z"),
			}),
		).resolves.toMatchObject({
			status: "invalid_expression",
			hit: false,
		});
	});

	it("enforces cooldown and minimum interval before creating repeated runs", async () => {
		const { scheduledTasks, rollups, siteId, adminUserId } =
			await createFixture();
		await rollups.increment({
			siteKey: "fangyuan",
			metricKey: "public.write",
			value: 10,
			at: new Date("2026-06-04T10:00:00.000Z"),
		});
		const task = await scheduledTasks.create({
			name: "Refresh on public writes",
			type: "page_source_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "condition",
			payload: {
				siteKey: "fangyuan",
				sitemapUrls: ["https://example.com/sitemap.xml"],
			},
			policy: {},
			trigger: conditionTrigger(
				{
					op: "metric",
					metricKey: "public.write",
					comparator: ">=",
					threshold: 1,
					windowSec: 300,
				},
				{ cooldownSec: 600, minIntervalSec: 600 },
			),
			nextRunAt: "2026-06-04T10:00:00.000Z",
			lastRunAt: "2026-06-04T09:55:00.000Z",
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});

		await expect(
			new ConditionTriggerEvaluator(rollups).evaluate(task, {
				now: new Date("2026-06-04T10:00:00.000Z"),
			}),
		).resolves.toMatchObject({
			status: "cooldown",
			hit: false,
		});
	});

	it("creates a normal condition-triggered run and advances the next evaluation time", async () => {
		const {
			scheduledTasks,
			taskRuns,
			eventLogs,
			rollups,
			scheduler,
			siteId,
			adminUserId,
		} = await createFixture();
		await rollups.increment({
			siteKey: "fangyuan",
			metricKey: "request.failed",
			value: 3,
			at: new Date("2026-06-04T10:00:00.000Z"),
		});
		const task = await scheduledTasks.create({
			name: "Refresh titles on errors",
			type: "page_metadata_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "condition",
			payload: { siteKey: "fangyuan", scope: "missing_only" },
			policy: {},
			trigger: conditionTrigger({
				op: "metric",
				metricKey: "request.failed",
				comparator: ">=",
				threshold: 3,
				windowSec: 300,
			}),
			nextRunAt: "2026-06-04T10:00:00.000Z",
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});

		const tick = await scheduler.tick({
			now: new Date("2026-06-04T10:00:00.000Z"),
		});
		const run = await taskRuns.getRequired(tick.createdRunIds[0]);
		const updatedTask = await scheduledTasks.getRequired(task.id);
		const events = await eventLogs.listForRun({
			taskRunId: run.id,
			limit: 10,
			offset: 0,
			includePrivate: true,
		});

		expect(tick.createdRunIds).toHaveLength(1);
		expect(run).toMatchObject({
			status: "queued",
			trigger: "condition",
			triggerSnapshot: {
				status: "hit",
				values: [
					expect.objectContaining({
						metricKey: "request.failed",
						value: 3,
						hit: true,
					}),
				],
			},
		});
		expect(updatedTask).toMatchObject({
			lastRunId: run.id,
			lastStatus: "queued",
			nextRunAt: "2026-06-04T10:05:00.000Z",
			claimWorkerId: null,
			claimExpiresAt: null,
		});
		expect(events.items).toEqual([
			expect.objectContaining({
				eventType: "condition_hit",
				visibleToSiteAdmin: true,
			}),
		]);
	});

	it("records public request metrics without synchronously creating condition runs", async () => {
		const testApp = await createTestApp();
		cleanupCallbacks.push(testApp.cleanup);
		const clients = createDatabaseClients(testApp.databaseFile);
		cleanupCallbacks.push(() => {
			clients.sqlite.close();
		});
		const scheduledTasks = new ScheduledTaskRepository(clients.db);
		const taskRuns = new TaskRunRepository(clients.db);
		const rollups = new TaskMetricRollupRepository(clients.db);
		const [site] = await clients.db.select().from(sites).limit(1);
		const [adminUser] = await clients.db.select().from(adminUsers).limit(1);
		await scheduledTasks.create({
			name: "Refresh on public writes",
			type: "page_source_refresh",
			siteId: site.id,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "condition",
			payload: {
				siteKey: "fangyuan",
				sitemapUrls: ["https://example.com/sitemap.xml"],
			},
			policy: {},
			trigger: conditionTrigger({
				op: "metric",
				metricKey: "public.write",
				comparator: ">=",
				threshold: 1,
				windowSec: 300,
			}),
			nextRunAt: "2026-06-04T10:00:00.000Z",
			retentionCount: 5,
			ownerUserId: adminUser.id,
			createdByUserId: adminUser.id,
			updatedByUserId: adminUser.id,
		});

		const response = await testApp.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/captcha/refresh",
			payload: { siteKey: "fangyuan", pageKey: "post-1" },
			headers: { origin: "http://localhost:4321" },
		});
		const runs = await taskRuns.listForTaskCenter({
			category: "maintenance",
			limit: 10,
			offset: 0,
		});
		const metric = await rollups.sumWindow({
			siteKey: "fangyuan",
			metricKey: "public.write",
			windowSec: 300,
			now: new Date(),
		});

		expect(response.statusCode).toBeLessThan(500);
		expect(metric.value).toBe(1);
		expect(runs.totalCount).toBe(0);
	});
});
