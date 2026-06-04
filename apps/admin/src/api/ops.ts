import { requestJson } from "./client";
import type { TaskRunProjection, TaskRunStatus } from "./tasks";

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
	recentJobs: TaskRunProjection[];
}

export function fetchIpRegionMaintenanceStatus() {
	return requestJson<IpRegionMaintenanceStatus>("/api/admin/ops/ip-region");
}

export function createIpRegionUpdateJob(
	input: { ipVersions: IpVersion[] } & TaskExecutionOptions,
) {
	return requestJson<{ run: TaskRunProjection }>(
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
	return requestJson<{ run: TaskRunProjection }>(
		"/api/admin/ops/comment-ip/refresh",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export interface TaskRunCenterItem extends TaskRunProjection {
	source: "task_run";
	queueBackend: "database" | "bullmq";
	queueMessageId: string | null;
	actorType: "admin_user" | "system" | "visitor" | null;
	actorId: string | null;
	subjectType: string | null;
	subjectId: string | null;
	idempotencyKey: string | null;
	queueState: TaskQueueState;
}

export type AdminTaskCenterItem = TaskRunCenterItem;

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

export function createPageTitleRefreshTask(
	input: {
		siteKey: string;
		onlyMissingTitle?: boolean;
		pageKeys?: string[];
		forceTitle?: boolean;
	} & TaskExecutionOptions,
) {
	return requestJson<{ run: TaskRunProjection }>(
		"/api/admin/ops/tasks/page-title-refresh",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}
