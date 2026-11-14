import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	notificationChannelConfigs,
	notificationDeliveries,
	sites,
	taskEventLogs,
	taskRuns,
} from "../../src/db/schema";
import { ScheduledTaskRepository } from "../../src/modules/tasks/scheduled-task-repository";
import { TaskEventLogRepository } from "../../src/modules/tasks/task-event-log-repository";
import { TaskFailureNotificationService } from "../../src/modules/tasks/task-failure-notification-service";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import type { TaskRunRecord } from "../../src/modules/tasks/types";
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
	failureNotifications: TaskFailureNotificationService;
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
	const workspace = createTestWorkspace("qingyan-task-failure-notification-");
	await applyInitialMigration(workspace.databaseUrl);
	const clients = createDatabaseClients(workspace.databaseUrl);
	await clients.db.insert(sites).values({
		siteKey: "fangyuan",
		name: "FangYuan",
		allowedOriginsJson: "[]",
	});
	const [site] = await clients.db.select().from(sites).limit(1);
	await clients.db.insert(adminUsers).values({
		username: "task-admin",
		email: "task-admin@example.test",
		passwordHash: "hash",
		displayName: "Task Admin",
		isInitialAdmin: true,
	});
	const [adminUser] = await clients.db.select().from(adminUsers).limit(1);
	await clients.db.insert(adminGroups).values({
		key: "site_admin",
		name: "Site Admin",
	});
	const [adminGroup] = await clients.db.select().from(adminGroups).limit(1);
	await clients.db.insert(adminUserGroups).values({
		userId: adminUser.id,
		groupId: adminGroup.id,
	});
	await clients.db.insert(adminUserSiteAccess).values({
		userId: adminUser.id,
		siteId: site.id,
	});
	const fixture = {
		workspace,
		db: clients.db,
		close: clients.close,
		scheduledTasks: new ScheduledTaskRepository(clients.db),
		taskRuns: new TaskRunRepository(clients.db),
		eventLogs: new TaskEventLogRepository(clients.db),
		failureNotifications: new TaskFailureNotificationService(clients.db),
		siteId: site.id,
		adminUserId: adminUser.id,
	};
	fixtures.push(fixture);
	return fixture;
}

async function createFailedRun(
	fixture: Fixture,
	input?: {
		policy?: unknown;
		createdAt?: string;
	},
): Promise<TaskRunRecord> {
	const task = await fixture.scheduledTasks.create({
		name: "Refresh titles",
		type: "page_metadata_refresh",
		siteId: fixture.siteId,
		scopeKind: "site",
		scope: { siteKey: "fangyuan" },
		enabled: true,
		scheduleKind: "manual_only",
		payload: { siteKey: "fangyuan", scope: "missing_only" },
		policy: input?.policy ?? {},
		trigger: { kind: "manual" },
		retentionCount: 5,
		ownerUserId: fixture.adminUserId,
		createdByUserId: fixture.adminUserId,
		updatedByUserId: fixture.adminUserId,
	});
	const run = await fixture.taskRuns.createScheduledTaskRun({
		scheduledTask: task,
		trigger: "manual",
		triggerSnapshot: {},
		input: task.payload,
		createdAt: input?.createdAt,
		updatedAt: input?.createdAt,
	});
	return fixture.taskRuns.markFailed(run.id, {
		code: "TASK_RUN_FAILED",
		message: "test failure",
	});
}

async function notificationRunsForSubject(
	fixture: Fixture,
	subjectRunId: string,
) {
	const rows = await fixture.db
		.select()
		.from(taskRuns)
		.where(
			and(
				eq(taskRuns.type, "task_failure_notification"),
				eq(taskRuns.subjectId, subjectRunId),
			),
		);
	return rows;
}

describe("TaskFailureNotificationService", () => {
	it("does not enqueue notification tasks when failure notifications are disabled by default", async () => {
		const fixture = await createFixture();
		const failedRun = await createFailedRun(fixture);

		const result =
			await fixture.failureNotifications.planForFailedRun(failedRun);

		expect(result).toMatchObject({ createdCount: 0 });
		expect(
			await notificationRunsForSubject(fixture, failedRun.id),
		).toHaveLength(0);
		const events = await fixture.eventLogs.listForRun({
			taskRunId: failedRun.id,
			limit: 10,
			offset: 0,
			includePrivate: true,
		});
		expect(events.items).toHaveLength(0);
	});

	it("enqueues notification task and delivery for configured channel and recipient", async () => {
		const fixture = await createFixture();
		const failedRun = await createFailedRun(fixture, {
			policy: {
				failureNotification: {
					enabled: true,
					channelConfigIds: ["email:default"],
					recipientIds: [`user:${fixture.adminUserId}`],
				},
			},
		});

		const result =
			await fixture.failureNotifications.planForFailedRun(failedRun);

		expect(result).toMatchObject({ createdCount: 1 });
		const [notificationRun] = await notificationRunsForSubject(
			fixture,
			failedRun.id,
		);
		expect(notificationRun).toMatchObject({
			type: "task_failure_notification",
			category: "notification",
			status: "queued",
			siteId: fixture.siteId,
			siteKey: "fangyuan",
			subjectType: "task_run",
			subjectId: failedRun.id,
		});
		const deliveries = await fixture.db
			.select()
			.from(notificationDeliveries)
			.where(eq(notificationDeliveries.taskRunId, notificationRun.id));
		expect(deliveries).toEqual([
			expect.objectContaining({
				channel: "email",
				channelConfigRef: "email:default",
				recipientType: "backend_user",
				recipientUserId: fixture.adminUserId,
				status: "queued",
				eventFamily: "task_run_failed",
				templateKey: "task.failure",
			}),
		]);
		const events = await fixture.eventLogs.listForRun({
			taskRunId: failedRun.id,
			limit: 10,
			offset: 0,
			includePrivate: true,
		});
		expect(events.items).toEqual([
			expect.objectContaining({
				eventType: "task_failure_notification_enqueued",
				visibleToSiteAdmin: false,
			}),
		]);
	});

	it("sends an external failure notification without requiring a person", async () => {
		const fixture = await createFixture();
		await fixture.db.insert(notificationChannelConfigs).values({
			id: "webhook:ops",
			type: "webhook",
			name: "运维 Webhook",
			enabled: true,
			configJson: JSON.stringify({
				url: "https://hooks.example.test/qingyan",
			}),
			secretConfigJson: "{}",
		});
		const failedRun = await createFailedRun(fixture, {
			policy: {
				failureNotification: {
					enabled: true,
					channelConfigIds: ["webhook:ops"],
					recipientIds: [],
				},
			},
		});

		const result =
			await fixture.failureNotifications.planForFailedRun(failedRun);

		expect(result).toMatchObject({ createdCount: 1 });
		const [notificationRun] = await notificationRunsForSubject(
			fixture,
			failedRun.id,
		);
		const deliveries = await fixture.db
			.select()
			.from(notificationDeliveries)
			.where(eq(notificationDeliveries.taskRunId, notificationRun.id));
		expect(deliveries).toEqual([
			expect.objectContaining({
				channel: "webhook",
				channelConfigRef: "webhook:ops",
				recipientType: "external_target",
				recipientUserId: null,
				status: "queued",
			}),
		]);
	});

	it("records notification failure event for stale invalid notification snapshots without masking the run failure", async () => {
		const fixture = await createFixture();
		const failedRun = await createFailedRun(fixture, {
			policy: {
				failureNotification: {
					enabled: true,
					channelConfigIds: ["webhook:missing"],
					recipientIds: ["recipient-missing"],
				},
			},
		});

		const result =
			await fixture.failureNotifications.planForFailedRun(failedRun);

		expect(result).toMatchObject({ createdCount: 0 });
		expect((await fixture.taskRuns.getRequired(failedRun.id)).status).toBe(
			"failed",
		);
		expect(
			await notificationRunsForSubject(fixture, failedRun.id),
		).toHaveLength(0);
		const events = await fixture.eventLogs.listForRun({
			taskRunId: failedRun.id,
			limit: 10,
			offset: 0,
			includePrivate: true,
		});
		expect(events.items).toEqual([
			expect.objectContaining({
				eventType: "task_failure_notification_failed",
				level: "warn",
				visibleToSiteAdmin: false,
			}),
		]);
	});

	it("prunes old scheduled task runs with their event logs and notification deliveries", async () => {
		const fixture = await createFixture();
		const task = await fixture.scheduledTasks.create({
			name: "Retained task",
			type: "page_metadata_refresh",
			siteId: fixture.siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "manual_only",
			payload: { siteKey: "fangyuan", scope: "missing_only" },
			policy: {},
			trigger: { kind: "manual" },
			retentionCount: 2,
			ownerUserId: fixture.adminUserId,
			createdByUserId: fixture.adminUserId,
		});
		const runs = [];
		for (const [index, createdAt] of [
			"2026-06-04T00:00:00.000Z",
			"2026-06-04T01:00:00.000Z",
			"2026-06-04T02:00:00.000Z",
			"2026-06-04T03:00:00.000Z",
		].entries()) {
			const run = await fixture.taskRuns.createScheduledTaskRun({
				scheduledTask: task,
				trigger: "manual",
				status: "succeeded",
				triggerSnapshot: { index },
				input: task.payload,
				createdAt,
				updatedAt: createdAt,
			});
			runs.push(run);
			await fixture.eventLogs.append({
				taskRunId: run.id,
				eventType: "created",
				level: "info",
				message: "created",
			});
		}
		const oldRunIds = runs.slice(0, 2).map((run) => run.id);
		await fixture.taskRuns.createDelivery({
			taskRunId: runs[0].id,
			channel: "email",
			channelConfigRef: "email:default",
			channelConfigNameSnapshot: "默认邮件",
			recipientType: "backend_user",
			recipientUserId: fixture.adminUserId,
			recipientAddressSnapshot: "task-admin@example.test",
			recipientIdentityKey: "backend_user:test",
			eventFamily: "task_run_failed",
			templateKey: "task.failure",
		});

		const result = await fixture.taskRuns.pruneScheduledTaskRuns({
			scheduledTaskId: task.id,
			retainCount: 2,
		});

		expect(new Set(result.deletedRunIds)).toEqual(new Set(oldRunIds));
		const remainingRuns = await fixture.db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(eq(taskRuns.scheduledTaskId, task.id));
		expect(remainingRuns.map((run) => run.id)).toEqual([
			runs[2].id,
			runs[3].id,
		]);
		const remainingEvents = await fixture.db
			.select()
			.from(taskEventLogs)
			.where(inArray(taskEventLogs.taskRunId, oldRunIds));
		expect(remainingEvents).toHaveLength(0);
		const remainingDeliveries = await fixture.db
			.select()
			.from(notificationDeliveries)
			.where(inArray(notificationDeliveries.taskRunId, oldRunIds));
		expect(remainingDeliveries).toHaveLength(0);
	});
	it.each([
		false,
		true,
	])("waits for current failure planning before pruning (worker claim: %s)", async (claimRetry) => {
		const fixture = await createFixture();
		const firstFailure = await createFailedRun(fixture, {
			policy: {
				failureNotification: {
					enabled: true,
					channelConfigIds: ["webhook:missing"],
					recipientIds: [],
				},
			},
		});
		if (!firstFailure.scheduledTaskId)
			throw new Error("Expected scheduled run");
		const scheduled = await fixture.scheduledTasks.get(
			firstFailure.scheduledTaskId,
		);
		if (!scheduled) throw new Error("Expected scheduled task");
		const last = await fixture.taskRuns.createScheduledTaskRun({
			scheduledTask: scheduled,
			trigger: "manual",
			triggerSnapshot: {},
			input: {},
			status: "succeeded",
		});
		await fixture.scheduledTasks.updateLastRun(scheduled.id, {
			lastRunId: last.id,
			lastRunAt: last.createdAt,
			lastStatus: last.status,
		});
		const prune = () =>
			fixture.taskRuns.pruneScheduledTaskRuns({
				scheduledTaskId: scheduled.id,
				retainCount: 0,
			});
		expect((await prune()).deletedRunIds).toEqual([]);
		await fixture.failureNotifications.planForFailedRun(firstFailure);
		await fixture.taskRuns.markRetrying(
			firstFailure.id,
			{},
			new Date(0).toISOString(),
		);
		const claim = claimRetry
			? (await fixture.taskRuns.claimRunnable({ workerId: "retry" }))[0]
			: null;
		const currentFailure = await fixture.taskRuns.markFailed(
			firstFailure.id,
			{},
			claim?.claimToken,
		);
		expect((await prune()).deletedRunIds).toEqual([]);
		await fixture.failureNotifications.planForFailedRun(firstFailure);
		expect((await prune()).deletedRunIds).toEqual([]);
		await fixture.failureNotifications.planForFailedRun(currentFailure);
		expect((await prune()).deletedRunIds).toEqual([firstFailure.id]);
	});

	it("preserves active runs and terminal runs referenced by the schedule or another task", async () => {
		const fixture = await createFixture();
		const scheduled = await fixture.scheduledTasks.create({
			name: "retain references",
			type: "page_metadata_refresh",
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			scheduleKind: "manual_only",
			payload: {},
			policy: {},
			trigger: {},
			ownerUserId: fixture.adminUserId,
			retentionCount: 0,
		});
		const create = (status: "queued" | "succeeded", id: string) =>
			fixture.taskRuns.createScheduledTaskRun({
				id,
				scheduledTask: scheduled,
				trigger: "manual",
				triggerSnapshot: {},
				input: {},
				status,
			});
		const queued = await create("queued", "keep-queued"),
			last = await create("succeeded", "keep-last"),
			referenced = await create("succeeded", "keep-ref"),
			obsolete = await create("succeeded", "delete-terminal");
		await fixture.scheduledTasks.updateLastRun(scheduled.id, {
			lastRunAt: last.createdAt,
			lastRunId: last.id,
			lastStatus: last.status,
		});
		const notification = await fixture.taskRuns.create({
			type: "task_failure_notification",
			category: "notification",
			payload: {},
			subjectType: "task_run",
			subjectId: referenced.id,
		});
		const pruned = await fixture.taskRuns.pruneScheduledTaskRuns({
			scheduledTaskId: scheduled.id,
			retainCount: 0,
		});
		expect(pruned.deletedRunIds).toEqual([obsolete.id]);
		for (const run of [queued, last, referenced])
			expect(await fixture.taskRuns.get(run.id)).not.toBeNull();
		await fixture.taskRuns.markSucceeded(notification.id, {});
		await fixture.taskRuns.finalizeScheduledTaskRun(notification.id);
		expect(await fixture.taskRuns.get(referenced.id)).toBeNull();
		expect(await fixture.taskRuns.get(last.id)).not.toBeNull();
		expect(await fixture.taskRuns.get(queued.id)).not.toBeNull();
	});
});
