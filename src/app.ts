import Fastify, { type FastifyInstance } from "fastify";
import { joinPublicPath } from "./config/public-path";
import type { AppRuntimeOptions } from "./config/runtime-options";
import type { AppConfig } from "./config/types";
import { createMemoryLoggerManager } from "./logging/memory-logger-manager";
import { adminBlacklistRoutes } from "./modules/admin/blacklist-routes";
import { adminOpsRoutes } from "./modules/admin/ops-routes";
import { adminOverviewRoutes } from "./modules/admin/overview-routes";
import { adminNotificationTemplateRoutes } from "./modules/admin/notification-template-routes";
import { adminPageRegistryRoutes } from "./modules/admin/page-registry-routes";
import { adminPagesRoutes } from "./modules/admin/pages-routes";
import { adminProfileRoutes } from "./modules/admin/profile-routes";
import { createPasswordHash } from "./modules/admin/password-hash";
import { adminSessionRoutes } from "./modules/admin/session-routes";
import { adminSettingsRoutes } from "./modules/admin/settings-routes";
import { adminSitesRoutes } from "./modules/admin/sites-routes";
import { adminSystemSettingsRoutes } from "./modules/admin/system-settings-routes";
import { adminUiRoutes } from "./modules/admin/ui-routes";
import { adminCommentersRoutes } from "./modules/admin/commenters-routes";
import { adminVisitorsRoutes } from "./modules/admin/visitors-routes";
import { adminUsersRoutes } from "./modules/admin/admin-users-routes";
import { commentsAdminRoutes } from "./modules/comments/admin-routes";
import type { AkismetClient } from "./modules/comments/akismet-client";
import { captchaWidgetRoutes } from "./modules/comments/captcha-widget-routes";
import type { CommentMetadataResolver } from "./modules/comments/metadata/resolver";
import { commentsPublicRoutes } from "./modules/comments/public-routes";
import { createDevMemoryRoutes } from "./modules/dev/memory-routes";
import { DevMockService } from "./modules/dev/mock-service";
import { registerDatabaseDevRoutes } from "./modules/dev/routes";
import { adminImportExportRoutes } from "./modules/import-export/admin-routes";
import { pageFeedbackPublicRoutes } from "./modules/page-feedback/public-routes";
import type { fetchPageSourceText } from "./modules/page-registry/source-fetcher";
import type { EmailSender } from "./modules/notifications/channels/email-channel";
import type { AdminProfileEmailSender } from "./modules/admin/profile-service";
import { notificationsPublicRoutes } from "./modules/notifications/public-routes";
import type { ServiceControlController } from "./modules/service-control/systemd-service";
import { buildErrorResponse } from "./modules/shared/error-response";
import { AppError } from "./modules/shared/errors";
import { createSiteRegistry } from "./modules/shared/site-registry";
import { loadOpenApiDocument, renderOpenApiHtml } from "./openapi/load-openapi";
import cookiePlugin from "./plugins/cookie";
import dbPlugin from "./plugins/db";
import loggingPlugin from "./plugins/logging";
import requestContextPlugin from "./plugins/request-context";
import securityPlugin from "./plugins/security";

type OpenApiDocument = Awaited<ReturnType<typeof loadOpenApiDocument>>;

interface BuildAppOptions {
	adminDistDirectory?: string;
	akismetClient?: Pick<AkismetClient, "commentCheck">;
	commentMetadataResolver?: CommentMetadataResolver;
	pageSourceFetchText?: typeof fetchPageSourceText;
	pageTitleFetchHtml?: (
		url: string,
		options: { timeoutMs: number; maxBytes: number },
	) => Promise<{ status: number; text: string }>;
	serviceControl?: ServiceControlController;
	emailSender?: EmailSender;
	adminProfileEmailSender?: AdminProfileEmailSender;
}

function registerBaseRoutes(
	app: FastifyInstance,
	openApi: OpenApiDocument,
	publicPath: string,
): void {
	app.get(joinPublicPath(publicPath, "/healthz"), async () => ({
		service: "QingYan",
		status: "ok",
	}));
	app.get(joinPublicPath(publicPath, "/openapi.yaml"), async (_, reply) =>
		reply.type("application/yaml; charset=utf-8").send(openApi.yamlText),
	);
	app.get(
		joinPublicPath(publicPath, "/openapi.json"),
		async () => openApi.json,
	);
	app.get(joinPublicPath(publicPath, "/docs"), async (_, reply) =>
		reply
			.type("text/html; charset=utf-8")
			.send(renderOpenApiHtml(joinPublicPath(publicPath, "/openapi.yaml"))),
	);
}

function isDevMemoryMode(runtimeOptions: AppRuntimeOptions): boolean {
	return (
		runtimeOptions.devMode.enabled &&
		runtimeOptions.devMode.storage === "memory"
	);
}

function describeError(error: unknown) {
	if (error instanceof Error) {
		return {
			name: error.name,
			errorMessage: error.message,
			stack: error.stack,
		};
	}

	return {
		name: typeof error,
		errorMessage: String(error),
		stack: undefined,
	};
}

export async function buildApp(
	config: AppConfig,
	runtimeOptions: AppRuntimeOptions = {
		devMode: {
			enabled: false,
		},
	},
	options: BuildAppOptions = {},
): Promise<FastifyInstance> {
	const app = Fastify({
		logger: true,
		disableRequestLogging: true,
		routerOptions: {
			ignoreTrailingSlash: true,
		},
		trustProxy: config.server.trustProxy,
	});
	const publicPath = config.server.publicPath;
	const openApi = await loadOpenApiDocument(publicPath);
	const devSeedSite = runtimeOptions.devMode.seed?.site;

	app.decorate("config", config);
	app.decorate("runtimeOptions", runtimeOptions);
	app.decorate("siteRegistry", createSiteRegistry());
	if (options.akismetClient) {
		app.decorate("akismetClient", options.akismetClient);
	}
	if (options.commentMetadataResolver) {
		app.decorate("commentMetadataResolver", options.commentMetadataResolver);
	}
	if (options.pageSourceFetchText) {
		app.decorate("pageSourceFetchText", options.pageSourceFetchText);
	}
	if (options.pageTitleFetchHtml) {
		app.decorate("pageTitleFetchHtml", options.pageTitleFetchHtml);
	}
	if (options.serviceControl) {
		app.decorate("serviceControl", options.serviceControl);
	}
	if (options.emailSender) {
		app.decorate("emailSender", options.emailSender);
	}
	if (options.adminProfileEmailSender) {
		app.decorate("adminProfileEmailSender", options.adminProfileEmailSender);
	}

	app.setErrorHandler(async (error, request, reply) => {
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
			const response = buildErrorResponse(error, requestId);
			return reply.status(response.statusCode).send(response.body);
		}

		const errorDetails = describeError(error);
		app.log.error({ err: error }, "Unhandled request error");
		await app.loggerManager
			.logApp({
				level: "error",
				channel: "app",
				event: "service.crashed",
				message: "Unhandled request error",
				requestId,
				siteKey: request.context?.siteKey,
				pageKey: request.context?.pageKey,
				data: {
					...errorDetails,
					method: request.method,
					path: request.url.split("?")[0] ?? request.url,
				},
			})
			.catch((logError: unknown) => {
				app.log.error({ err: logError }, "Failed to write request error log");
			});
		const response = buildErrorResponse(error, requestId);
		return reply.status(response.statusCode).send(response.body);
	});

	await app.register(cookiePlugin);

	if (isDevMemoryMode(runtimeOptions)) {
		if (!devSeedSite) {
			throw new Error("Dev memory mode requires a seed site.");
		}

		const devMockService = new DevMockService(devSeedSite);
		app.decorate("devMockService", devMockService);
		app.decorate("loggerManager", createMemoryLoggerManager(config));
		const adminBootstrap = {
			consolePath: config.admin.console.path ?? "/admin",
			username: runtimeOptions.devMode.adminUsername ?? "admin",
			passwordHash: createPasswordHash(
				runtimeOptions.devMode.adminPassword ?? "admin",
			),
			generatedPassword: runtimeOptions.devMode.adminPassword ?? "admin",
		};
		app.decorate("adminBootstrap", adminBootstrap);
		await app.register(requestContextPlugin);
		registerBaseRoutes(app, openApi, publicPath);
		await app.register(adminUiRoutes, {
			prefix: publicPath,
			publicPath,
			distDirectory: options.adminDistDirectory,
		});
		await app.register(
			createDevMemoryRoutes({
				devMockService,
				runtimeOptions,
			}),
			{ prefix: joinPublicPath(publicPath, "/api") },
		);
		return app;
	}

	await app.register(dbPlugin);
	await app.register(requestContextPlugin);
	await app.register(securityPlugin);
	await app.register(loggingPlugin);

	registerBaseRoutes(app, openApi, publicPath);

	await app.register(adminUiRoutes, {
		prefix: publicPath,
		publicPath,
		distDirectory: options.adminDistDirectory,
	});
	await app.register(adminSessionRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/session"),
	});
	await app.register(captchaWidgetRoutes, {
		prefix: joinPublicPath(publicPath, "/api"),
	});

	if (runtimeOptions.devMode.enabled) {
		registerDatabaseDevRoutes(app, runtimeOptions, {
			prefix: joinPublicPath(publicPath, "/api"),
		});
	}

	await app.register(adminOverviewRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/overview"),
	});
	await app.register(adminOpsRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/ops"),
	});
	await app.register(commentsPublicRoutes, {
		prefix: joinPublicPath(publicPath, "/api"),
	});
	await app.register(pageFeedbackPublicRoutes, {
		prefix: joinPublicPath(publicPath, "/api"),
	});
	await app.register(notificationsPublicRoutes, {
		prefix: joinPublicPath(publicPath, "/notifications"),
	});
	await app.register(commentsAdminRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/comments"),
	});
	await app.register(adminPagesRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/pages"),
	});
	await app.register(adminPageRegistryRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/page-registry"),
	});
	await app.register(adminCommentersRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/commenters"),
	});
	await app.register(adminVisitorsRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/visitors"),
	});
	await app.register(adminBlacklistRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/blacklist"),
	});
	await app.register(adminSitesRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/sites"),
	});
	await app.register(adminSettingsRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/settings"),
	});
	await app.register(adminSystemSettingsRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/system-settings"),
	});
	await app.register(adminNotificationTemplateRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/notification-templates"),
	});
	await app.register(adminUsersRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin"),
	});
	await app.register(adminProfileRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/profile"),
	});
	await app.register(adminImportExportRoutes, {
		prefix: joinPublicPath(publicPath, "/api/admin/import-export"),
	});

	return app;
}
