import type { AppConfig, SiteConfig } from "../config/types";
import type { AppDatabase, SqliteClient } from "../db/client";
import type { LoggerManager } from "../logging/logger-manager";
import type { VisitorIdentity } from "../modules/shared/visitor";
import type { SecurityToolkit } from "../plugins/security";
import type { SiteRegistry } from "../modules/shared/site-registry";

export interface RequestContext {
	requestId: string;
	siteKey?: string;
	pageKey?: string;
	site?: SiteConfig;
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
		db: AppDatabase;
		loggerManager: LoggerManager;
		sqlite: SqliteClient;
		security: SecurityToolkit;
		siteRegistry: SiteRegistry;
	}

	interface FastifyRequest {
		context?: RequestContext;
	}
}
