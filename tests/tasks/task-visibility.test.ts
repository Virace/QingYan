import { describe, expect, it } from "vitest";

import type { ScheduledTaskRecord } from "../../src/modules/tasks/scheduled-task-repository";
import type { TaskRunRecord } from "../../src/modules/tasks/types";
import {
	projectScheduledTaskForSession,
	projectTaskRunForSession,
	type TaskVisibilitySession,
} from "../../src/modules/tasks/task-visibility";

function session(input: Partial<TaskVisibilitySession>): TaskVisibilitySession {
	return {
		userId: input.userId ?? 1,
		groupKey: input.groupKey ?? "admin",
		isAdmin: input.isAdmin ?? input.groupKey === "admin",
		isInitialAdmin: input.isInitialAdmin ?? false,
		siteIds: input.siteIds ?? [],
	};
}

const scheduledTask = {
	id: "scheduled_task_1",
	name: "Refresh titles",
	type: "page_metadata_refresh",
	siteId: 10,
	scopeKind: "site",
	scope: { siteKey: "fangyuan" },
	enabled: true,
	scheduleKind: "interval",
	schedulePreset: null,
	cronExpression: null,
	timezone: null,
	payload: { siteKey: "fangyuan", scope: "missing_only" },
	policy: { maxAttempts: 2 },
	trigger: { everyMinutes: 30 },
	nextRunAt: "2026-06-04T10:30:00.000Z",
	lastRunAt: null,
	lastRunId: null,
	lastStatus: null,
	retentionCount: 5,
	ownerUserId: 1,
	createdByUserId: 1,
	updatedByUserId: 1,
	createdAt: "2026-06-04T10:00:00.000Z",
	updatedAt: "2026-06-04T10:00:00.000Z",
	description: null,
	disabledReason: null,
	payloadSchemaVersion: 1,
	triggerSchemaVersion: 1,
	claimWorkerId: null,
	claimExpiresAt: null,
	transferredByUserId: null,
	transferredAt: null,
	deletedAt: null,
} satisfies ScheduledTaskRecord;

const taskRun = {
	id: "task_run_1",
	scheduledTaskId: "scheduled_task_1",
	scheduledTaskNameSnapshot: "Refresh titles",
	type: "page_metadata_refresh",
	category: "maintenance",
	status: "failed",
	siteId: 10,
	siteKey: null,
	scopeKind: "site",
	scope: { siteKey: "fangyuan" },
	trigger: "schedule",
	triggerSnapshot: { dueAt: "2026-06-04T10:00:00.000Z" },
	input: { siteKey: "fangyuan", scope: "missing_only" },
	actionConfigSnapshot: { payload: { siteKey: "fangyuan" } },
	payloadSummary: { scheduledTaskName: "Refresh titles" },
	payload: { siteKey: "fangyuan", scope: "missing_only" },
	result: { count: 0 },
	error: { code: "PAGE_FETCH_FAILED" },
	ownerUserIdSnapshot: 1,
	createdByUserId: 1,
	createdAt: "2026-06-04T10:00:00.000Z",
	updatedAt: "2026-06-04T10:01:00.000Z",
	finishedAt: "2026-06-04T10:01:00.000Z",
	queueBackend: "database",
	queueMessageId: null,
	actorType: null,
	actorId: null,
	subjectType: "scheduled_task",
	subjectId: "scheduled_task_1",
	progress: null,
	idempotencyKey: null,
	runAfter: null,
	attempts: 1,
	maxAttempts: 1,
	retryDelaySec: 0,
	priority: 0,
	concurrencyKey: "task:page_metadata_refresh:site:{}",
	workerId: null,
	lockConflictWithRunId: null,
	lockConflictWithTaskName: null,
	skipReason: null,
	blockReason: null,
	startedAt: "2026-06-04T10:00:00.000Z",
} satisfies TaskRunRecord;

describe("task visibility projection", () => {
	it("returns full scheduled task definition for owners and initial admins", () => {
		expect(
			projectScheduledTaskForSession(scheduledTask, {
				session: session({ userId: 1, groupKey: "site_admin", siteIds: [10] }),
			}),
		).toMatchObject({
			visibility: "definition",
			payload: { siteKey: "fangyuan", scope: "missing_only" },
			policy: { maxAttempts: 2 },
			canManage: true,
			canViewLogs: true,
		});

		expect(
			projectScheduledTaskForSession(scheduledTask, {
				session: session({ userId: 99, isInitialAdmin: true }),
			}),
		).toMatchObject({
			visibility: "definition",
			canManage: true,
		});
	});

	it("returns summary only for non-owner site scoped users", () => {
		const projected = projectScheduledTaskForSession(scheduledTask, {
			session: session({
				userId: 2,
				groupKey: "site_moderator",
				siteIds: [10],
			}),
		});

		expect(projected).toMatchObject({
			visibility: "summary",
			id: "scheduled_task_1",
			name: "Refresh titles",
			canManage: false,
			canRun: false,
			canViewLogs: false,
		});
		expect(projected).not.toHaveProperty("payload");
		expect(projected).not.toHaveProperty("policy");
	});

	it("hides tasks outside a scoped user's site access", () => {
		expect(
			projectScheduledTaskForSession(scheduledTask, {
				session: session({ userId: 2, groupKey: "site_admin", siteIds: [99] }),
			}),
		).toBeNull();
	});

	it("hides raw run details from summary viewers", () => {
		const projected = projectTaskRunForSession(taskRun, {
			session: session({
				userId: 2,
				groupKey: "site_admin",
				siteIds: [10],
			}),
		});

		expect(projected).toMatchObject({
			visibility: "run_summary",
			id: "task_run_1",
			status: "failed",
			canViewLogs: false,
		});
		expect(projected).not.toHaveProperty("input");
		expect(projected).not.toHaveProperty("error");
	});
});
