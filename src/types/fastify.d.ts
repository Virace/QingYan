import type { AppRuntimeOptions } from "../config/runtime-options";
import type { AppConfig } from "../config/types";
import type { AppDatabase, SqliteClient } from "../db/client";
import type { LoggerManager } from "../logging/logger-manager";
import type { AdminBootstrap } from "../modules/admin/bootstrap-service";
import type { DevMockService } from "../modules/dev/mock-service";
import type { AkismetClient } from "../modules/comments/akismet-client";
import type { VisitorIdentity } from "../modules/shared/visitor";
import type { SecurityToolkit } from "../plugins/security";
import type { SiteRegistry } from "../modules/shared/site-registry";

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
		akismetClient?: Pick<AkismetClient, "commentCheck">;
		pageSourceFetchText?: (url: string) => Promise<string>;
		pageTitleFetchHtml?: (
			url: string,
		) => Promise<{ status: number; text: string }>;
		devMockService?: DevMockService;
	}

	interface FastifyRequest {
		context?: RequestContext;
	}
}
