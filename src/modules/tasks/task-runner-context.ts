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
import type { TaskLogWriter } from "./task-log-writer";

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
	log: TaskLogWriter;
	writeEvent: (event: TaskRunnerEventInput) => Promise<void> | void;
	updateProgress: (progress: unknown) => Promise<void> | void;
	writeAudit: (event: unknown) => Promise<void> | void;
	signal?: AbortSignal;
	now: () => Date;
}

export interface TaskRunnerServices {
	pageSourceRefresh?: {
		executeRefresh(input: {
			siteKey: string;
			sourceIds?: number[];
			mode?: "append" | "replace";
			trigger: PageSourceRefreshTrigger;
			timeoutMs?: number;
			maxBytes?: number;
		}, context: TaskRunnerContext): Promise<unknown>;
	};
	pageMetadataRefresh?: {
		executeRefresh(
			input: PageMetadataRefreshScope,
			context: TaskRunnerContext,
		): Promise<unknown>;
	};
	commentIpMaintenance?: {
		executeCommentIpRefresh(
			input: CommentIpRefreshInput,
			context: TaskRunnerContext,
		): Promise<unknown>;
		executeIpRegionUpdate(input: {
			ipVersions: IpVersion[];
			timeoutMs?: number;
		}, context: TaskRunnerContext): Promise<unknown>;
	};
	backup?: BackupTaskService;
	siteSettingsAction?: SiteSettingsActionTaskService;
	blacklistAutomation?: BlacklistAutomationTaskService;
	dailySiteDigest?: DailySiteDigestTaskService;
}
