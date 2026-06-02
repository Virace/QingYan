import { requestJson } from "./client";

export interface OpsStatus {
	version: {
		current: string;
	};
	update: {
		supported: boolean;
		entry: "service-action";
		description: string;
		estimatedRestartSeconds: {
			min: number;
			max: number;
		};
		check: UpdateCheckResult;
	};
	upgrade: {
		state:
			| "not_installed"
			| "normal_current"
			| "upgrade_required"
			| "recovery_required"
			| "broken_config";
		plan?: unknown;
	};
	backup: {
		format: "qingyan.full-backup";
		provider: "sqlite";
	};
	recovery: {
		manualCommands: string[];
	};
}

export type UpdateCheckState =
	| "not_checked"
	| "no_release"
	| "current"
	| "update_available"
	| "unsupported_release"
	| "check_failed";

export interface UpdateCheckResult {
	state: UpdateCheckState;
	currentVersion: string;
	latestVersion?: string;
	releaseName?: string;
	releaseUrl?: string;
	tagName?: string;
	publishedAt?: string;
	prerelease?: boolean;
	autoUpdatable: boolean;
	source: {
		provider: "github-releases";
		owner: string;
		repo: string;
		url: string;
	};
	message: string;
	checkedAt?: string;
	errorCode?: string;
}

export interface UpdatePlan {
	kind: "program-update";
	executor: "qingyan.service";
	description: string;
	estimatedRestartSeconds: {
		min: number;
		max: number;
	};
	steps: string[];
	manualCommands: string[];
}

export interface ServiceControlStatus {
	enabled: boolean;
	mode: "disabled" | "systemd";
	unit: string;
	state: "running" | "stopped" | "unknown";
	restart: {
		confirmation: "RESTART QINGYAN";
	};
}

export function fetchOpsStatus() {
	return requestJson<OpsStatus>("/api/admin/ops/status");
}

export function fetchUpgradeDryRun() {
	return requestJson<unknown>("/api/admin/ops/upgrade/dry-run", {
		method: "POST",
	});
}

export function fetchUpdatePlan() {
	return requestJson<UpdatePlan>("/api/admin/ops/update/plan", {
		method: "POST",
	});
}

export function fetchUpdateCheck() {
	return requestJson<UpdateCheckResult>("/api/admin/ops/update/check", {
		method: "POST",
	});
}

export function fetchServiceControlStatus() {
	return requestJson<ServiceControlStatus>("/api/admin/ops/service-control");
}

export function restartService(input: { confirm: string }) {
	return requestJson<{ ok: boolean; state: ServiceControlStatus["state"] }>(
		"/api/admin/ops/service-control/restart",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export type IpVersion = "v4" | "v6";
export type MaintenanceJobStatus =
	| "queued"
	| "delayed"
	| "running"
	| "retrying"
	| "succeeded"
	| "failed"
	| "suppressed"
	| "cancelled";

export interface MaintenanceJob {
	id: string;
	type:
		| "ip_region_update"
		| "comment_ip_refresh"
		| "page_source_refresh"
		| "page_metadata_refresh";
	status: MaintenanceJobStatus;
	siteKey: string | null;
	scope: unknown;
	progress: unknown;
	result: unknown;
	error: unknown;
	runAfter: string | null;
	attempts: number;
	maxAttempts: number;
	retryDelaySec: number;
	priority: number;
	concurrencyKey: string | null;
	lastHeartbeatAt: string | null;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	updatedAt: string;
}

export interface TaskQueueState {
	waitingReason:
		| "ready_for_runner"
		| "delayed_until_run_after"
		| "global_concurrency_limit"
		| "type_concurrency_limit"
		| "concurrency_key_blocked"
		| "retry_wait"
		| "terminal";
	waitingDescription: string;
	blockedByJobId?: string;
	readyAt: string | null;
}

export interface TaskExecutionOptions {
	executionMode?: "async";
	batchSize?: number;
	timeoutMs?: number;
	maxBytes?: number;
	maxAttempts?: number;
	retryDelaySec?: number;
	runAfter?: string | null;
}

export interface IpRegionMaintenanceStatus {
	databases: Array<{
		ipVersion: IpVersion;
		filePath: string;
		fileHash: string;
		sourceUrl: string | null;
		cachePolicy: string;
		activatedAt: string;
		updatedAt: string;
	}>;
	recentRuns: Array<{
		ipVersion: IpVersion;
		status: string;
		refreshedComments: number;
		errorMessage: string | null;
		createdAt: string;
	}>;
	commentMetadata: {
		totalWithIp: number;
		missingLocation: number;
		failedLocation: number;
	};
	recentJobs: MaintenanceJob[];
}

export function fetchIpRegionMaintenanceStatus() {
	return requestJson<IpRegionMaintenanceStatus>("/api/admin/ops/ip-region");
}

export function createIpRegionUpdateJob(
	input: { ipVersions: IpVersion[] } & TaskExecutionOptions,
) {
	return requestJson<{ job: MaintenanceJob }>(
		"/api/admin/ops/ip-region/update",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function createCommentIpRefreshJob(
	input: {
		scope: "missing" | "failed" | "stale" | "all";
		ipVersions: IpVersion[];
		siteKey?: string;
	} & TaskExecutionOptions,
) {
	return requestJson<{ job: MaintenanceJob }>(
		"/api/admin/ops/comment-ip/refresh",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function fetchMaintenanceJob(jobId: string) {
	return requestJson<{ job: MaintenanceJob | null }>(
		`/api/admin/ops/maintenance-jobs/${encodeURIComponent(jobId)}`,
	);
}

export interface TaskCenterItem extends MaintenanceJob {
	source: "maintenance";
	queueState: TaskQueueState;
}

export interface TaskRunCenterItem {
	source: "task_run";
	id: string;
	queueBackend: "database" | "bullmq";
	queueMessageId: string | null;
	type: string;
	category:
		| "notification"
		| "import"
		| "maintenance"
		| "backup"
		| "upgrade"
		| "page"
		| "system";
	status: MaintenanceJobStatus;
	siteId: number | null;
	siteKey: string | null;
	actorType: "admin_user" | "system" | "visitor" | null;
	actorId: string | null;
	subjectType: string | null;
	subjectId: string | null;
	payloadSummary: unknown;
	payload: unknown;
	scope: unknown;
	progress: unknown;
	result: unknown;
	error: unknown;
	idempotencyKey: string | null;
	runAfter: string | null;
	attempts: number;
	maxAttempts: number;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	updatedAt: string;
	queueState: TaskQueueState;
}

export type AdminTaskCenterItem = TaskCenterItem | TaskRunCenterItem;

export function listTasks(input: {
	siteKey?: string;
	type?: string;
	status?: string;
	limit?: number;
	offset?: number;
}) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(input)) {
		if (value !== undefined && value !== "") {
			params.set(key, String(value));
		}
	}
	const query = params.toString();
	return requestJson<{
		items: AdminTaskCenterItem[];
		totalCount: number;
		limit: number;
		offset: number;
	}>(`/api/admin/ops/tasks${query ? `?${query}` : ""}`);
}

export function runTaskNow(jobId: string) {
	return requestJson<{ job: MaintenanceJob }>(
		`/api/admin/ops/tasks/${encodeURIComponent(jobId)}/run-now`,
		{ method: "POST" },
	);
}

export function prioritizeTask(jobId: string) {
	return requestJson<{ job: MaintenanceJob }>(
		`/api/admin/ops/tasks/${encodeURIComponent(jobId)}/prioritize`,
		{ method: "POST" },
	);
}

export function createPageTitleRefreshTask(
	input: {
		siteKey: string;
		onlyMissingTitle?: boolean;
		pageKeys?: string[];
		forceTitle?: boolean;
	} & TaskExecutionOptions,
) {
	return requestJson<{ job: MaintenanceJob }>(
		"/api/admin/ops/tasks/page-title-refresh",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}
