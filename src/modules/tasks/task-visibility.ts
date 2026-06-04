import type { AdminGroupKey } from "../admin/permissions";
import type {
	ScheduledTaskDeletedSnapshotRecord,
	ScheduledTaskRecord,
} from "./scheduled-task-repository";
import type { TaskRunRecord } from "./types";

export interface TaskVisibilitySession {
	userId: number;
	groupKey: AdminGroupKey;
	isAdmin: boolean;
	isInitialAdmin: boolean;
	siteIds: number[];
}

export type TaskVisibilityLevel =
	| "summary"
	| "definition"
	| "run_summary"
	| "run_detail"
	| "deleted_snapshot";

function hasSiteAccess(
	session: TaskVisibilitySession,
	siteId?: number | null,
): boolean {
	if (session.isAdmin || session.isInitialAdmin) {
		return true;
	}
	if (!siteId) {
		return false;
	}
	return session.siteIds.includes(siteId);
}

export function canManageScheduledTask(
	task: Pick<ScheduledTaskRecord, "ownerUserId" | "siteId">,
	session: TaskVisibilitySession,
): boolean {
	if (session.isAdmin || session.isInitialAdmin) {
		return true;
	}
	return (
		session.groupKey === "site_admin" &&
		task.ownerUserId === session.userId &&
		hasSiteAccess(session, task.siteId)
	);
}

export function canRunScheduledTask(
	task: Pick<ScheduledTaskRecord, "ownerUserId" | "siteId">,
	session: TaskVisibilitySession,
): boolean {
	return canManageScheduledTask(task, session);
}

export function canViewTaskLogs(
	input: Pick<TaskRunRecord, "ownerUserIdSnapshot" | "siteId">,
	session: TaskVisibilitySession,
): boolean {
	if (session.isAdmin || session.isInitialAdmin) {
		return true;
	}
	return (
		session.groupKey === "site_admin" &&
		input.ownerUserIdSnapshot === session.userId &&
		hasSiteAccess(session, input.siteId)
	);
}

export function projectScheduledTaskForSession(
	task: ScheduledTaskRecord,
	input: { session: TaskVisibilitySession },
) {
	if (!hasSiteAccess(input.session, task.siteId)) {
		return null;
	}
	const canManage = canManageScheduledTask(task, input.session);
	const canRun = canRunScheduledTask(task, input.session);
	const canViewLogs = canManage;
	const base = {
		id: task.id,
		name: task.name,
		description: task.description,
		type: task.type,
		siteId: task.siteId,
		scopeKind: task.scopeKind,
		enabled: task.enabled,
		disabledReason: task.disabledReason,
		scheduleKind: task.scheduleKind,
		schedulePreset: task.schedulePreset,
		cronExpression: task.cronExpression,
		timezone: task.timezone,
		nextRunAt: task.nextRunAt,
		lastRunAt: task.lastRunAt,
		lastRunId: task.lastRunId,
		lastStatus: task.lastStatus,
		ownerUserId: task.ownerUserId,
		createdByUserId: task.createdByUserId,
		updatedByUserId: task.updatedByUserId,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		canManage,
		canRun,
		canViewLogs,
	};
	if (!canManage) {
		return {
			...base,
			visibility: "summary" as const,
		};
	}
	return {
		...base,
		visibility: "definition" as const,
		scope: task.scope,
		payload: task.payload,
		payloadSchemaVersion: task.payloadSchemaVersion,
		policy: task.policy,
		trigger: task.trigger,
		triggerSchemaVersion: task.triggerSchemaVersion,
		retentionCount: task.retentionCount,
		transferredByUserId: task.transferredByUserId,
		transferredAt: task.transferredAt,
	};
}

export function projectTaskRunForSession(
	run: TaskRunRecord,
	input: { session: TaskVisibilitySession },
) {
	if (!hasSiteAccess(input.session, run.siteId)) {
		return null;
	}
	const canViewLogs = canViewTaskLogs(run, input.session);
	const base = {
		id: run.id,
		scheduledTaskId: run.scheduledTaskId,
		scheduledTaskNameSnapshot: run.scheduledTaskNameSnapshot,
		type: run.type,
		category: run.category,
		status: run.status,
		siteId: run.siteId,
		siteKey: run.siteKey,
		scopeKind: run.scopeKind,
		trigger: run.trigger,
		ownerUserIdSnapshot: run.ownerUserIdSnapshot,
		createdByUserId: run.createdByUserId,
		skipReason: run.skipReason,
		blockReason: run.blockReason,
		runAfter: run.runAfter,
		createdAt: run.createdAt,
		startedAt: run.startedAt,
		finishedAt: run.finishedAt,
		updatedAt: run.updatedAt,
		canViewLogs,
	};
	if (!canViewLogs) {
		return {
			...base,
			visibility: "run_summary" as const,
		};
	}
	return {
		...base,
		visibility: "run_detail" as const,
		scope: run.scope,
		triggerSnapshot: run.triggerSnapshot,
		input: run.input,
		actionConfigSnapshot: run.actionConfigSnapshot,
		payloadSummary: run.payloadSummary,
		payload: run.payload,
		progress: run.progress,
		result: run.result,
		error: run.error,
		attempts: run.attempts,
		maxAttempts: run.maxAttempts,
		retryDelaySec: run.retryDelaySec,
		priority: run.priority,
		concurrencyKey: run.concurrencyKey,
		workerId: run.workerId,
		lockConflictWithRunId: run.lockConflictWithRunId,
		lockConflictWithTaskName: run.lockConflictWithTaskName,
	};
}

export function projectDeletedSnapshotForSession(
	snapshot: ScheduledTaskDeletedSnapshotRecord,
) {
	return {
		visibility: "deleted_snapshot" as const,
		id: snapshot.id,
		scheduledTaskId: snapshot.scheduledTaskId,
		deletedByUserId: snapshot.deletedByUserId,
		deletedAt: snapshot.deletedAt,
		deleteReason: snapshot.deleteReason,
		lastRunId: snapshot.lastRunId,
		lastStatus: snapshot.lastStatus,
		snapshot: {
			id: snapshot.snapshot.id,
			name: snapshot.snapshot.name,
			type: snapshot.snapshot.type,
			siteId: snapshot.snapshot.siteId,
			ownerUserId: snapshot.snapshot.ownerUserId,
		},
	};
}
