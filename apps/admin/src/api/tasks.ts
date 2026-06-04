import { requestJson } from "./client";

export type TaskScheduleKind =
	| "manual_only"
	| "once"
	| "interval"
	| "daily"
	| "weekly"
	| "monthly"
	| "cron";

export type TaskRunStatus =
	| "queued"
	| "delayed"
	| "running"
	| "retrying"
	| "succeeded"
	| "failed"
	| "skipped"
	| "blocked"
	| "suppressed"
	| "cancelled";

export type TaskVisibility =
	| "summary"
	| "definition"
	| "run_summary"
	| "run_detail"
	| "deleted_snapshot";

export interface TaskTypeDefinition {
	type: string;
	label: string;
	description: string;
	category: string;
	scope: "global" | "site" | "multi_site" | "page";
	permissions: {
		read: string;
		create: string;
		run: string;
		update: string;
		delete: string;
	};
	defaultPayload: Record<string, unknown>;
	defaultPolicy: TaskPolicyInput;
	schedule: {
		manual: boolean;
		presets: string[];
		cron: boolean;
		condition: boolean;
	};
	dangerous: boolean;
	reuse: {
		service: string;
		method: string;
		file: string;
	};
}

export interface TaskPolicyInput {
	maxAttempts?: number;
	retryDelaySec?: number;
	timeoutMs?: number;
	maxBytes?: number;
	concurrencyKey?: string;
	failureNotification?: {
		enabled: boolean;
		channelConfigIds: string[];
		recipientIds: string[];
	};
}

export interface TaskTriggerInput {
	runAt?: string;
	everyMinutes?: number;
	time?: string;
	dayOfWeek?: number;
	dayOfMonth?: number;
}

export interface ScheduledTaskWriteInput {
	name: string;
	description?: string | null;
	type: string;
	siteKey?: string | null;
	scopeKind: string;
	scope: Record<string, unknown>;
	enabled: boolean;
	scheduleKind: TaskScheduleKind;
	schedulePreset?: string | null;
	cronExpression?: string | null;
	timezone?: string | null;
	payload: Record<string, unknown>;
	policy: TaskPolicyInput;
	trigger: TaskTriggerInput;
	retentionCount: number;
}

export interface ScheduledTaskProjection {
	id: string;
	name: string;
	description: string | null;
	type: string;
	siteId: number | null;
	scopeKind: string;
	enabled: boolean;
	disabledReason: string | null;
	scheduleKind: TaskScheduleKind;
	schedulePreset: string | null;
	cronExpression: string | null;
	timezone: string | null;
	nextRunAt: string | null;
	lastRunAt: string | null;
	lastRunId: string | null;
	lastStatus: TaskRunStatus | null;
	ownerUserId: number;
	ownerDisplayName?: string | null;
	systemKey?: string | null;
	systemManaged?: boolean;
	protectionKind?: string | null;
	managedBy?: string | null;
	protectedReason?: string;
	protectedActions?: {
		delete: boolean;
		disable: boolean;
		transferOwner: boolean;
	};
	canDelete?: boolean;
	canDisable?: boolean;
	canTransferOwner?: boolean;
	createdByUserId: number | null;
	updatedByUserId: number | null;
	createdAt: string;
	updatedAt: string;
	canManage: boolean;
	canRun: boolean;
	canViewLogs: boolean;
	visibility: "summary" | "definition";
	scope?: unknown;
	payload?: Record<string, unknown>;
	payloadSchemaVersion?: number;
	protection?: {
		kind: string;
		managedBy: string;
		lockedDelete?: boolean;
		lockedDisable?: boolean;
		lockedOwnerTransfer?: boolean;
		lockedType?: boolean;
		lockedSite?: boolean;
		lockedPayloadPaths?: string[];
		editablePayloadPaths?: string[];
		editableFields?: string[];
	} | null;
	policy?: TaskPolicyInput;
	trigger?: TaskTriggerInput;
	triggerSchemaVersion?: number;
	retentionCount?: number;
	transferredByUserId?: number | null;
	transferredAt?: string | null;
}

export interface ScheduledTaskDeletedSnapshot {
	visibility: "deleted_snapshot";
	id: string;
	scheduledTaskId: string;
	deletedByUserId: number | null;
	deletedAt: string;
	deleteReason: string | null;
	lastRunId: string | null;
	lastStatus: TaskRunStatus | null;
	snapshot: {
		id: string;
		name: string;
		type: string;
		siteId: number | null;
		ownerUserId: number;
	};
}

export interface TaskRunProjection {
	id: string;
	scheduledTaskId: string | null;
	scheduledTaskNameSnapshot: string | null;
	type: string;
	category: string;
	status: TaskRunStatus;
	siteId: number | null;
	siteKey: string | null;
	scopeKind: string | null;
	trigger: string | null;
	ownerUserIdSnapshot: number | null;
	createdByUserId: number | null;
	skipReason: string | null;
	blockReason: string | null;
	runAfter: string | null;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	updatedAt: string;
	canViewLogs: boolean;
	visibility: "run_summary" | "run_detail";
	scope?: unknown;
	triggerSnapshot?: unknown;
	input?: unknown;
	actionConfigSnapshot?: unknown;
	payloadSummary?: unknown;
	payload?: unknown;
	progress?: unknown;
	result?: unknown;
	error?: unknown;
	attempts?: number;
	maxAttempts?: number;
	retryDelaySec?: number;
	priority?: number;
	concurrencyKey?: string | null;
	workerId?: string | null;
	lockConflictWithRunId?: string | null;
	lockConflictWithTaskName?: string | null;
}

export interface TaskRunLogLine {
	id: string;
	taskRunId: string;
	sequence: number;
	stream: "stdout" | "stderr" | "system";
	level: "debug" | "info" | "warn" | "error";
	eventType: string;
	message: string;
	data?: unknown;
	createdAt: string;
}

export interface TaskAuditItem {
	id: number;
	siteId: number | null;
	actorType: string;
	actorId: string | null;
	action: string;
	targetType: string;
	targetId: string | null;
	taskName?: unknown;
	taskType?: unknown;
	siteKey?: unknown;
	runId?: unknown;
	runStatus?: unknown;
	requestId?: unknown;
	scheduledTaskId?: unknown;
	createdAt: string;
}

export function listTaskDefinitions() {
	return requestJson<{ items: TaskTypeDefinition[] }>(
		"/api/admin/tasks/definitions",
	);
}

export function listScheduledTasks() {
	return requestJson<{ items: ScheduledTaskProjection[]; totalCount: number }>(
		"/api/admin/tasks/scheduled",
	);
}

export function createScheduledTask(input: ScheduledTaskWriteInput) {
	return requestJson<ScheduledTaskProjection>("/api/admin/tasks/scheduled", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function updateScheduledTask(
	id: string,
	input: ScheduledTaskWriteInput,
) {
	return requestJson<ScheduledTaskProjection>(
		`/api/admin/tasks/scheduled/${encodeURIComponent(id)}`,
		{
			method: "PATCH",
			body: JSON.stringify(input),
		},
	);
}

export function deleteScheduledTask(id: string, reason?: string | null) {
	return requestJson<ScheduledTaskDeletedSnapshot>(
		`/api/admin/tasks/scheduled/${encodeURIComponent(id)}`,
		{
			method: "DELETE",
			body: JSON.stringify({ reason: reason ?? null }),
		},
	);
}

export function runScheduledTask(id: string) {
	return requestJson<TaskRunProjection>(
		`/api/admin/tasks/scheduled/${encodeURIComponent(id)}/run`,
		{ method: "POST" },
	);
}

export function enableScheduledTask(id: string) {
	return requestJson<ScheduledTaskProjection>(
		`/api/admin/tasks/scheduled/${encodeURIComponent(id)}/enable`,
		{ method: "POST" },
	);
}

export function disableScheduledTask(id: string, reason = "manual_disabled") {
	return requestJson<ScheduledTaskProjection>(
		`/api/admin/tasks/scheduled/${encodeURIComponent(id)}/disable`,
		{
			method: "POST",
			body: JSON.stringify({ reason }),
		},
	);
}

export function transferScheduledTaskOwner(id: string, ownerUserId: number) {
	return requestJson<ScheduledTaskProjection>(
		`/api/admin/tasks/scheduled/${encodeURIComponent(id)}/transfer-owner`,
		{
			method: "POST",
			body: JSON.stringify({ ownerUserId }),
		},
	);
}

export function listTaskRuns() {
	return requestJson<{ items: TaskRunProjection[]; totalCount: number }>(
		"/api/admin/tasks/runs",
	);
}

export function getTaskRun(id: string) {
	return requestJson<TaskRunProjection>(
		`/api/admin/tasks/runs/${encodeURIComponent(id)}`,
	);
}

export function listTaskRunLogs(
	id: string,
	input: { afterSequence?: number; limit?: number } = {},
) {
	const params = new URLSearchParams();
	if (input.afterSequence !== undefined) {
		params.set("afterSequence", String(input.afterSequence));
	}
	if (input.limit !== undefined) {
		params.set("limit", String(input.limit));
	}
	const query = params.toString();
	return requestJson<{
		items: TaskRunLogLine[];
		nextSequence: number;
		hasMore: boolean;
	}>(
		`/api/admin/tasks/runs/${encodeURIComponent(id)}/logs${
			query ? `?${query}` : ""
		}`,
	);
}

export function listTaskAudit() {
	return requestJson<{ items: TaskAuditItem[]; totalCount: number }>(
		"/api/admin/tasks/audit",
	);
}

export function listDeletedTaskSnapshots() {
	return requestJson<{
		items: ScheduledTaskDeletedSnapshot[];
		totalCount: number;
	}>("/api/admin/tasks/deleted-snapshots");
}

export function getDeletedTaskSnapshot(id: string) {
	return requestJson<ScheduledTaskDeletedSnapshot>(
		`/api/admin/tasks/deleted-snapshots/${encodeURIComponent(id)}`,
	);
}

export function cancelTaskRun(id: string) {
	return requestJson<TaskRunProjection>(
		`/api/admin/tasks/runs/${encodeURIComponent(id)}/cancel`,
		{ method: "POST" },
	);
}

export function retryTaskRun(id: string) {
	return requestJson<TaskRunProjection>(
		`/api/admin/tasks/runs/${encodeURIComponent(id)}/retry`,
		{ method: "POST" },
	);
}
