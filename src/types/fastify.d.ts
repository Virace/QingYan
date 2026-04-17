import type { AppConfig, SiteConfig } from "../config/types";
import type { AppDatabase, SqliteClient } from "../db/client";
import type { VisitorIdentity } from "../modules/shared/visitor";
import type { SecurityToolkit } from "../plugins/security";
import type { SiteRegistry } from "../modules/shared/site-registry";

export interface RequestContext {
	requestId: string;
	siteKey?: string;
	site?: SiteConfig;
	visitor?: VisitorIdentity;
	ip: string;
	userAgent?: string;
}

declare module "fastify" {
	interface FastifyInstance {
		config: AppConfig;
		db: AppDatabase;
		sqlite: SqliteClient;
		security: SecurityToolkit;
		siteRegistry: SiteRegistry;
	}

	interface FastifyRequest {
		context?: RequestContext;
	}
}
