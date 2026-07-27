export type TaskQueueBackend = "database" | "bullmq";

export type TaskRunCategory =
	| "notification"
	| "import"
	| "maintenance"
	| "backup"
	| "upgrade"
	| "page"
	| "system";

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

export type TaskActorType = "admin_user" | "system" | "visitor";

export interface TaskQueuePayload {
	type: string;
	category: TaskRunCategory;
	payload: unknown;
	payloadSummary?: unknown;
	siteId?: number | null;
	siteKey?: string | null;
	actorType?: TaskActorType | null;
	actorId?: string | null;
	subjectType?: string | null;
	subjectId?: string | null;
	idempotencyKey?: string | null;
	runAfter?: string | null;
	maxAttempts?: number;
	retryDelaySec?: number;
	priority?: number;
	concurrencyKey?: string | null;
	queueMessageId?: string | null;
}

export interface TaskRunRecord {
	id: string;
	queueBackend: TaskQueueBackend;
	queueMessageId: string | null;
	scheduledTaskId: string | null;
	scheduledTaskNameSnapshot: string | null;
	type: string;
	category: TaskRunCategory;
	status: TaskRunStatus;
	siteId: number | null;
	siteKey: string | null;
	scopeKind: string | null;
	scope: unknown;
	trigger: string | null;
	triggerSnapshot: unknown;
	input: unknown;
	actionConfigSnapshot: unknown;
	actorType: TaskActorType | null;
	actorId: string | null;
	subjectType: string | null;
	subjectId: string | null;
	payloadSummary: unknown;
	payload: unknown;
	progress: unknown;
	result: unknown;
	error: unknown;
	idempotencyKey: string | null;
	runAfter: string | null;
	attempts: number;
	maxAttempts: number;
	retryDelaySec: number;
	priority: number;
	concurrencyKey: string | null;
	workerId: string | null;
	lockConflictWithRunId: string | null;
	lockConflictWithTaskName: string | null;
	ownerUserIdSnapshot: number | null;
	createdByUserId: number | null;
	skipReason: string | null;
	blockReason: string | null;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	updatedAt: string;
}

export interface NotificationDeliveryRecord {
	id: string;
	taskRunId: string;
	channel: string;
	channelConfigRef: string | null;
	channelConfigNameSnapshot: string | null;
	recipientType: "backend_user" | "external_target" | "commenter" | "test";
	recipientUserId: number | null;
	recipientAddressSnapshot: string;
	recipientIdentityKey: string;
	eventFamily: string;
	templateKey: string;
	status: string;
	providerMessageId: string | null;
	lastError: unknown;
	sentAt: string | null;
	updatedAt: string;
}

export interface TaskClaimScope {
	includeCategories?: TaskRunCategory[];
	excludeCategories?: TaskRunCategory[];
}

export type TaskClaimOptions = TaskClaimScope & {
	nowIso?: string;
	limit?: number;
};

export interface TaskQueue {
	enqueue(task: TaskQueuePayload): Promise<TaskRunRecord>;
	claim(worker: string, options?: TaskClaimOptions): Promise<TaskRunRecord[]>;
	ack(taskId: string, result: unknown): Promise<void>;
	retry(taskId: string, error: unknown, runAfter: string): Promise<void>;
	fail(taskId: string, error: unknown): Promise<void>;
	cancel(taskId: string, reason: unknown): Promise<void>;
}

export function parseNullableJson(value: string | null): unknown {
	if (value === null || value === "") {
		return null;
	}
	return JSON.parse(value) as unknown;
}

export function stringifyJson(value: unknown): string {
	return JSON.stringify(value ?? null);
}
