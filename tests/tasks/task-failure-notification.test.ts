import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { createDatabaseClients } from "../../src/db/client";
import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	notificationDeliveries,
	sites,
	taskEventLogs,
	taskRuns,
} from "../../src/db/schema";
import { BackendUserNotificationRecipientsRepository } from "../../src/modules/notifications/backend-user-recipients-repository";
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
	sqlite: ReturnType<typeof createDatabaseClients>["sqlite"];
	scheduledTasks: ScheduledTaskRepository;
	taskRuns: TaskRunRepository;
	eventLogs: TaskEventLogRepository;
	recipients: BackendUserNotificationRecipientsRepository;
	failureNotifications: TaskFailureNotificationService;
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
	const workspace = createTestWorkspace("qingyan-task-failure-notification-");
	applyInitialMigration(workspace.databaseFile);
	const clients = createDatabaseClients(workspace.databaseFile);
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
		sqlite: clients.sqlite,
		scheduledTasks: new ScheduledTaskRepository(clients.db),
		taskRuns: new TaskRunRepository(clients.db),
		eventLogs: new TaskEventLogRepository(clients.db),
		recipients: new BackendUserNotificationRecipientsRepository(clients.db),
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
		const [recipient] = await fixture.recipients.replaceSiteRecipients({
			siteId: fixture.siteId,
			recipients: [
				{
					userId: fixture.adminUserId,
					routes: [
						{
							eventType: "admin_comment_pending",
							channelConfigId: "email:default",
							enabled: true,
						},
					],
					includeCommentContent: "summary",
					enabled: true,
				},
			],
		});
		const failedRun = await createFailedRun(fixture, {
			policy: {
				failureNotification: {
					enabled: true,
					channelConfigIds: ["email:default"],
					recipientIds: [recipient.id],
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
});
