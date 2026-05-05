import Fastify, { type FastifyInstance } from "fastify";

import type { AppRuntimeOptions } from "./config/runtime-options";
import type { AppConfig } from "./config/types";
import { createMemoryLoggerManager } from "./logging/memory-logger-manager";
import { adminBlacklistRoutes } from "./modules/admin/blacklist-routes";
import { createPasswordHash } from "./modules/admin/password-hash";
import { adminOverviewRoutes } from "./modules/admin/overview-routes";
import { adminPagesRoutes } from "./modules/admin/pages-routes";
import { adminSessionRoutes } from "./modules/admin/session-routes";
import { adminSystemSettingsRoutes } from "./modules/admin/system-settings-routes";
import { adminSitesRoutes } from "./modules/admin/sites-routes";
import { adminUiRoutes } from "./modules/admin/ui-routes";
import { adminUsersRoutes } from "./modules/admin/users-routes";
import { adminVisitorsRoutes } from "./modules/admin/visitors-routes";
import { commentsAdminRoutes } from "./modules/comments/admin-routes";
import { captchaWidgetRoutes } from "./modules/comments/captcha-widget-routes";
import { commentsPublicRoutes } from "./modules/comments/public-routes";
import { createDevMemoryRoutes } from "./modules/dev/memory-routes";
import { DevMockService } from "./modules/dev/mock-service";
import { registerDatabaseDevRoutes } from "./modules/dev/routes";
import { adminImportExportRoutes } from "./modules/import-export/admin-routes";
import { pageFeedbackPublicRoutes } from "./modules/page-feedback/public-routes";
import { AppError } from "./modules/shared/errors";
import { createSiteRegistry } from "./modules/shared/site-registry";
import { loadOpenApiDocument, renderOpenApiHtml } from "./openapi/load-openapi";
import cookiePlugin from "./plugins/cookie";
import dbPlugin from "./plugins/db";
import loggingPlugin from "./plugins/logging";
import requestContextPlugin from "./plugins/request-context";
import securityPlugin from "./plugins/security";

type OpenApiDocument = Awaited<ReturnType<typeof loadOpenApiDocument>>;

function registerBaseRoutes(
	app: FastifyInstance,
	openApi: OpenApiDocument,
): void {
	app.get("/healthz", async () => ({
		service: "QingYan",
		status: "ok",
	}));
	app.get("/openapi.yaml", async (_, reply) =>
		reply.type("application/yaml; charset=utf-8").send(openApi.yamlText),
	);
	app.get("/openapi.json", async () => openApi.json);
	app.get("/docs", async (_, reply) =>
		reply.type("text/html; charset=utf-8").send(renderOpenApiHtml()),
	);
}

function isDevMemoryMode(runtimeOptions: AppRuntimeOptions): boolean {
	return (
		runtimeOptions.devMode.enabled &&
		runtimeOptions.devMode.storage === "memory"
	);
}

export async function buildApp(
	config: AppConfig,
	runtimeOptions: AppRuntimeOptions = {
		devMode: {
			enabled: false,
		},
	},
): Promise<FastifyInstance> {
	const app = Fastify({
		logger: true,
		disableRequestLogging: true,
		routerOptions: {
			ignoreTrailingSlash: true,
		},
		trustProxy: config.server.trustProxy,
	});
	const openApi = await loadOpenApiDocument();
	const devSeedSite = runtimeOptions.devMode.seed?.site;

	app.decorate("config", config);
	app.decorate("runtimeOptions", runtimeOptions);
	app.decorate("siteRegistry", createSiteRegistry());

	app.setErrorHandler((error, request, reply) => {
		const requestId = request.context?.requestId ?? request.id;
		const accessEvent =
			error instanceof AppError
				? error.code === "INVALID_REQUEST"
					? {
							event: "request.validation_failed" as const,
							errorCode: error.code,
						}
					: error.code.includes("BLACKLISTED")
						? {
								event: "request.blocked.blacklist" as const,
								errorCode: error.code,
							}
						: error.code.includes("RATE_LIMITED")
							? {
									event: "request.rate_limited" as const,
									errorCode: error.code,
								}
							: {
									event: "request.failed" as const,
									errorCode: error.code,
								}
				: {
						event: "request.failed" as const,
						errorCode: "INTERNAL_ERROR",
					};
		if (request.context) {
			request.context.accessEvent = accessEvent;
		}

		if (error instanceof AppError) {
			reply.status(error.statusCode).send({
				error: {
					code: error.code,
					message: error.message,
					requestId,
					details: error.details ?? null,
				},
			});
			return;
		}

		app.log.error({ err: error }, "Unhandled request error");
		reply.status(500).send({
			error: {
				code: "INTERNAL_ERROR",
				message: "服务器内部错误。",
				requestId,
				details: null,
			},
		});
	});

	await app.register(cookiePlugin);

	if (isDevMemoryMode(runtimeOptions)) {
		if (!devSeedSite) {
			throw new Error("Dev memory mode requires a seed site.");
		}

		const devMockService = new DevMockService(devSeedSite);
		app.decorate("devMockService", devMockService);
		app.decorate("loggerManager", createMemoryLoggerManager(config));
		app.decorate("adminBootstrap", {
			consolePath: config.admin.console.path ?? "/admin",
			username: runtimeOptions.devMode.adminUsername ?? "admin",
			passwordHash: createPasswordHash(
				runtimeOptions.devMode.adminPassword ?? "admin",
			),
			generatedPassword: runtimeOptions.devMode.adminPassword ?? "admin",
		});
		await app.register(requestContextPlugin);
		registerBaseRoutes(app, openApi);
		await app.register(adminUiRoutes);
		await app.register(
			createDevMemoryRoutes({
				devMockService,
				runtimeOptions,
			}),
		);
		return app;
	}

	await app.register(dbPlugin);
	await app.register(requestContextPlugin);
	await app.register(securityPlugin);
	await app.register(loggingPlugin);

	registerBaseRoutes(app, openApi);

	await app.register(adminUiRoutes);
	await app.register(adminSessionRoutes, { prefix: "/api/admin/session" });
	await app.register(captchaWidgetRoutes, { prefix: "/api" });

	if (runtimeOptions.devMode.enabled) {
		registerDatabaseDevRoutes(app, runtimeOptions);
	}

	await app.register(adminOverviewRoutes, { prefix: "/api/admin/overview" });
	await app.register(commentsPublicRoutes, { prefix: "/api" });
	await app.register(pageFeedbackPublicRoutes, { prefix: "/api" });
	await app.register(commentsAdminRoutes, { prefix: "/api/admin/comments" });
	await app.register(adminPagesRoutes, { prefix: "/api/admin/pages" });
	await app.register(adminUsersRoutes, { prefix: "/api/admin/users" });
	await app.register(adminVisitorsRoutes, { prefix: "/api/admin/visitors" });
	await app.register(adminBlacklistRoutes, { prefix: "/api/admin/blacklist" });
	await app.register(adminSitesRoutes, { prefix: "/api/admin/sites" });
	await app.register(adminSystemSettingsRoutes, {
		prefix: "/api/admin/system-settings",
	});
	await app.register(adminImportExportRoutes, {
		prefix: "/api/admin/import-export",
	});

	return app;
}
