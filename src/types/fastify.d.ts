import type { AppRuntimeOptions } from "../config/runtime-options";
import type { AppConfig } from "../config/types";
import type { AppDatabase, SqliteClient } from "../db/client";
import type { LoggerManager } from "../logging/logger-manager";
import type { AdminBootstrap } from "../modules/admin/bootstrap-service";
import type { DevMockService } from "../modules/dev/mock-service";
import type { AkismetClient } from "../modules/comments/akismet-client";
import type { CommentMetadataResolver } from "../modules/comments/metadata/resolver";
import type { VisitorIdentity } from "../modules/shared/visitor";
import type { SecurityToolkit } from "../plugins/security";
import type { ServiceControlController } from "../modules/service-control/systemd-service";
import type { SiteRegistry } from "../modules/shared/site-registry";
import type { EmailSender } from "../modules/notifications/channels/email-channel";
import type { AdminProfileEmailSender } from "../modules/admin/profile-service";
import type { TaskMetricRollupRepository } from "../modules/tasks/task-metric-rollup-repository";

export interface RequestContext {
	requestId: string;
	siteKey?: string;
	pageKey?: string;
	visitor?: VisitorIdentity;
	ip: string;
	startedAt: number;
	userAgent?: string;
	accessEvent?: {
		event:
			| "request.completed"
			| "request.failed"
			| "request.blocked.blacklist"
			| "request.rate_limited"
			| "request.validation_failed";
		errorCode?: string;
	};
}

declare module "fastify" {
	interface FastifyInstance {
		config: AppConfig;
		adminBootstrap: AdminBootstrap;
		db: AppDatabase;
		loggerManager: LoggerManager;
		runtimeOptions: AppRuntimeOptions;
		sqlite: SqliteClient;
		security: SecurityToolkit;
		siteRegistry: SiteRegistry;
		taskMetricRollups: TaskMetricRollupRepository;
		akismetClient?: Pick<AkismetClient, "commentCheck">;
		commentMetadataResolver?: CommentMetadataResolver;
		pageSourceFetchText?: (
			url: string,
			options: {
				allowedOrigins: string[];
				timeoutMs?: number;
				maxBytes?: number;
			},
		) => Promise<string>;
		pageTitleFetchHtml?: (
			url: string,
			options: {
				allowedOrigins: string[];
				timeoutMs: number;
				maxBytes: number;
			},
		) => Promise<{ status: number; text: string }>;
		serviceControl?: ServiceControlController;
		emailSender?: EmailSender;
		adminProfileEmailSender?: AdminProfileEmailSender;
		devMockService?: DevMockService;
	}

	interface FastifyRequest {
		context?: RequestContext;
	}
}
