import Fastify, { type FastifyInstance } from "fastify";

import type { AppConfig } from "./config/types";
import { adminBlacklistRoutes } from "./modules/admin/blacklist-routes";
import { adminPagesRoutes } from "./modules/admin/pages-routes";
import { adminSessionRoutes } from "./modules/admin/session-routes";
import { adminSettingsRoutes } from "./modules/admin/settings-routes";
import { adminSitesRoutes } from "./modules/admin/sites-routes";
import { adminUiRoutes } from "./modules/admin/ui-routes";
import { adminUsersRoutes } from "./modules/admin/users-routes";
import { adminVisitorsRoutes } from "./modules/admin/visitors-routes";
import { commentsAdminRoutes } from "./modules/comments/admin-routes";
import { commentsPublicRoutes } from "./modules/comments/public-routes";
import { pageFeedbackPublicRoutes } from "./modules/page-feedback/public-routes";
import { AppError } from "./modules/shared/errors";
import { createSiteRegistry } from "./modules/shared/site-registry";
import { loadOpenApiDocument, renderOpenApiHtml } from "./openapi/load-openapi";
import cookiePlugin from "./plugins/cookie";
import dbPlugin from "./plugins/db";
import requestContextPlugin from "./plugins/request-context";
import securityPlugin from "./plugins/security";

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
	const app = Fastify({
		logger: true,
		routerOptions: {
			ignoreTrailingSlash: true,
		},
		trustProxy: config.server.trustProxy,
	});
	const openApi = await loadOpenApiDocument();

	app.decorate("config", config);
	app.decorate("siteRegistry", createSiteRegistry(config.sites));

	app.setErrorHandler((error, request, reply) => {
		const requestId = request.context?.requestId ?? request.id;

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
	await app.register(commentsPublicRoutes, { prefix: "/api" });
	await app.register(pageFeedbackPublicRoutes, { prefix: "/api" });
	await app.register(commentsAdminRoutes, { prefix: "/api/admin/comments" });
	await app.register(adminPagesRoutes, { prefix: "/api/admin/pages" });
	await app.register(adminUsersRoutes, { prefix: "/api/admin/users" });
	await app.register(adminVisitorsRoutes, { prefix: "/api/admin/visitors" });
	await app.register(adminBlacklistRoutes, { prefix: "/api/admin/blacklist" });
	await app.register(adminSitesRoutes, { prefix: "/api/admin/sites" });
	await app.register(adminSettingsRoutes, { prefix: "/api/admin/settings" });

	return app;
}
