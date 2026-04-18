import Fastify, { type FastifyInstance } from "fastify";

import type { AppRuntimeOptions } from "./config/runtime-options";
import type { AppConfig } from "./config/types";
import { adminBlacklistRoutes } from "./modules/admin/blacklist-routes";
import { adminPagesRoutes } from "./modules/admin/pages-routes";
import { AdminRepository } from "./modules/admin/repository";
import { AdminSessionService } from "./modules/admin/session-service";
import { adminSessionRoutes } from "./modules/admin/session-routes";
import { adminSettingsRoutes } from "./modules/admin/settings-routes";
import { adminSystemSettingsRoutes } from "./modules/admin/system-settings-routes";
import { adminSitesRoutes } from "./modules/admin/sites-routes";
import { adminUiRoutes } from "./modules/admin/ui-routes";
import { adminUsersRoutes } from "./modules/admin/users-routes";
import { adminVisitorsRoutes } from "./modules/admin/visitors-routes";
import { CaptchaService } from "./modules/comments/captcha-service";
import { commentsAdminRoutes } from "./modules/comments/admin-routes";
import { commentsPublicRoutes } from "./modules/comments/public-routes";
import { CommentsRepository } from "./modules/comments/repository";
import { CommentsWriteRepository } from "./modules/comments/write-repository";
import {
	devResetBodySchema,
	devScenarioBodySchema,
	devSessionBodySchema,
	devStateQuerySchema,
} from "./modules/dev/schemas";
import { DevModeService } from "./modules/dev/service";
import { DevMockService } from "./modules/dev/mock-service";
import { pageFeedbackPublicRoutes } from "./modules/page-feedback/public-routes";
import { AppError, InvalidRequestError } from "./modules/shared/errors";
import { createSiteRegistry } from "./modules/shared/site-registry";
import { loadOpenApiDocument, renderOpenApiHtml } from "./openapi/load-openapi";
import cookiePlugin from "./plugins/cookie";
import dbPlugin from "./plugins/db";
import loggingPlugin from "./plugins/logging";
import requestContextPlugin from "./plugins/request-context";
import securityPlugin from "./plugins/security";

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
	const devDefaultSite = runtimeOptions.devMode.defaultSite;

	app.decorate("config", config);
	app.decorate("runtimeOptions", runtimeOptions);
	app.decorate(
		"siteRegistry",
		createSiteRegistry(devDefaultSite ? [devDefaultSite] : config.sites, {
			runtimeOnlySiteKeys: devDefaultSite ? [devDefaultSite.siteKey] : [],
		}),
	);

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
	await app.register(dbPlugin);
	await app.register(requestContextPlugin);
	await app.register(securityPlugin);
	await app.register(loggingPlugin);

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

	await app.register(adminUiRoutes);
	await app.register(adminSessionRoutes, { prefix: "/api/admin/session" });

	if (runtimeOptions.devMode.enabled) {
		const defaultSite = devDefaultSite;
		const devMockService = defaultSite ? new DevMockService(defaultSite) : undefined;
		app.decorate("devMockService", devMockService);

		const commentsRepository = new CommentsRepository(app.db, app.siteRegistry);
		const adminSessionService = new AdminSessionService(
			app.config,
			app.security,
			new AdminRepository(app.db),
			app.siteRegistry,
		);
		const devService = new DevModeService(
			app.db,
			commentsRepository,
			new CaptchaService(
				app.config,
				app.security,
				commentsRepository,
				new CommentsWriteRepository(app.db),
			),
			adminSessionService,
		);

		app.post("/api/dev/session", async (request, reply) => {
			const parsed = devSessionBodySchema.safeParse(request.body);
			if (!parsed.success) {
				throw new InvalidRequestError({
					issues: parsed.error.issues,
				});
			}

			const result = await adminSessionService.createDevSession({
				expectedToken: runtimeOptions.devMode.adminToken ?? "",
				devToken: parsed.data.token,
				ip: request.context?.ip,
				requestId: request.context?.requestId,
				userAgent: request.context?.userAgent,
			});
			reply.setCookie(
				adminSessionService.getSessionCookieName(),
				result.sessionToken,
				{
					path: "/",
					sameSite: app.config.admin.session.sameSite,
					httpOnly: true,
					secure: app.config.admin.session.secure,
				},
			);

			return {
				authenticated: true,
				session: {
					expiresAt: result.expiresAt,
				},
			};
		});

		app.get("/api/dev/state", async (request) => {
			await devService.requireAdminSession(request);
			const parsed = devStateQuerySchema.safeParse(request.query);
			if (!parsed.success) {
				throw new InvalidRequestError({
					issues: parsed.error.issues,
				});
			}

			if (app.devMockService?.ownsSite(parsed.data.siteKey)) {
				return app.devMockService.inspect(
					parsed.data.siteKey,
					parsed.data.pageKey,
					parsed.data.visitorKey,
				);
			}

			return devService.inspect(
				parsed.data.siteKey,
				parsed.data.pageKey,
				parsed.data.visitorKey,
				{
					requestId: request.context?.requestId,
					ip: request.context?.ip,
					userAgent: request.context?.userAgent,
				},
			);
		});

		app.post("/api/dev/reset", async (request) => {
			await devService.requireAdminSession(request);
			const parsed = devResetBodySchema.safeParse(request.body);
			if (!parsed.success) {
				throw new InvalidRequestError({
					issues: parsed.error.issues,
				});
			}

			if (app.devMockService?.ownsSite(parsed.data.siteKey)) {
				return app.devMockService.resetPageState(
					parsed.data.siteKey,
					parsed.data.pageKey,
				);
			}

			return devService.resetPageState(parsed.data.siteKey, parsed.data.pageKey);
		});

		app.post("/api/dev/scenario", async (request) => {
			await devService.requireAdminSession(request);
			const parsed = devScenarioBodySchema.safeParse(request.body);
			if (!parsed.success) {
				throw new InvalidRequestError({
					issues: parsed.error.issues,
				});
			}

			if (app.devMockService?.ownsSite(parsed.data.siteKey)) {
				return app.devMockService.applyScenario(parsed.data);
			}

			return devService.applyScenario(parsed.data);
		});
	}

	await app.register(commentsPublicRoutes, { prefix: "/api" });
	await app.register(pageFeedbackPublicRoutes, { prefix: "/api" });
	await app.register(commentsAdminRoutes, { prefix: "/api/admin/comments" });
	await app.register(adminPagesRoutes, { prefix: "/api/admin/pages" });
	await app.register(adminUsersRoutes, { prefix: "/api/admin/users" });
	await app.register(adminVisitorsRoutes, { prefix: "/api/admin/visitors" });
	await app.register(adminBlacklistRoutes, { prefix: "/api/admin/blacklist" });
	await app.register(adminSitesRoutes, { prefix: "/api/admin/sites" });
	await app.register(adminSettingsRoutes, { prefix: "/api/admin/settings" });
	await app.register(adminSystemSettingsRoutes, {
		prefix: "/api/admin/system-settings",
	});

	return app;
}
