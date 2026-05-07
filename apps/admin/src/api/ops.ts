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
