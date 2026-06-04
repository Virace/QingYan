import type { AppDatabase } from "../../db/client";
import type {
	CommentIpRefreshInput,
	CommentIpMaintenanceService,
} from "../comments/metadata/comment-ip-maintenance-service";
import type { IpVersion } from "../comments/metadata/ip-region-updater";
import type { PageSourceRefreshTrigger } from "../page-registry/source-refresh-service";
import type { PageMetadataRefreshScope } from "../page-registry/title-refresh-service";
import type { BackupTaskService } from "./built-in/backup-task";
import type { BlacklistAutomationTaskService } from "./built-in/blacklist-automation-task";
import type { DailySiteDigestTaskService } from "./built-in/daily-site-digest-task";
import type { SiteSettingsActionTaskService } from "./built-in/site-settings-action-task";

export interface TaskRunnerActor {
	type: "admin_user" | "system";
	id?: string | null;
}

export interface TaskRunnerEventInput {
	eventType: string;
	level?: "debug" | "info" | "warn" | "error";
	message?: string;
	data?: unknown;
	visibleToSiteAdmin?: boolean;
}

export interface TaskRunnerContext {
	db?: AppDatabase;
	siteRegistry?: unknown;
	security?: unknown;
	logger?: {
		info?: (input: unknown, message?: string) => void;
		warn?: (input: unknown, message?: string) => void;
		error?: (input: unknown, message?: string) => void;
	};
	runId: string;
	scheduledTaskId?: string | null;
	actor: TaskRunnerActor;
	services: TaskRunnerServices;
	writeEvent: (event: TaskRunnerEventInput) => Promise<void> | void;
	updateProgress: (progress: unknown) => Promise<void> | void;
	writeAudit: (event: unknown) => Promise<void> | void;
	signal?: AbortSignal;
	now: () => Date;
}

export interface TaskRunnerServices {
	pageSourceRefresh?: {
		createRefreshJob(input: {
			siteKey: string;
			sourceIds?: number[];
			mode?: "append" | "replace";
			trigger: PageSourceRefreshTrigger;
			timeoutMs?: number;
			maxBytes?: number;
			maxAttempts?: number;
			retryDelaySec?: number;
		}): Promise<unknown>;
	};
	pageMetadataRefresh?: {
		createRefreshJob(input: PageMetadataRefreshScope): Promise<unknown>;
	};
	commentIpMaintenance?: Pick<
		CommentIpMaintenanceService,
		"createCommentIpRefreshJob" | "createIpRegionUpdateJob"
	> & {
		createCommentIpRefreshJob(input: CommentIpRefreshInput): Promise<unknown>;
		createIpRegionUpdateJob(input: {
			ipVersions: IpVersion[];
			timeoutMs?: number;
			runAfter?: string | null;
			maxAttempts?: number;
			retryDelaySec?: number;
		}): Promise<unknown>;
	};
	backup?: BackupTaskService;
	siteSettingsAction?: SiteSettingsActionTaskService;
	blacklistAutomation?: BlacklistAutomationTaskService;
	dailySiteDigest?: DailySiteDigestTaskService;
}
