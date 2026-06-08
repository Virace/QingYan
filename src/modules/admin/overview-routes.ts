import type { FastifyPluginAsync } from "fastify";

import { joinPublicPath } from "../../config/public-path";
import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import { AdminSessionService } from "./session-service";
import { requirePermission } from "./authorization";

export const adminOverviewRoutes: FastifyPluginAsync = async (fastify) => {
	const repository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		repository,
		fastify.adminBootstrap,
		fastify.siteRegistry,
	);
	const service = new AdminManagementService(
		fastify.security,
		fastify.siteRegistry,
		repository,
	);

	fastify.get("/", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "sites.read");
		const logging = fastify.loggerManager.getRuntimeSettings();

		return service.getOverview({
			consolePath: joinPublicPath(
				fastify.config.server.publicPath,
				fastify.adminBootstrap.consolePath,
			),
			devMode: fastify.runtimeOptions.devMode.enabled,
			logging: {
				level: logging.level,
				retentionDays: logging.retentionDays,
				directory: fastify.loggerManager.getLogDirectory(),
			},
		});
	});
};
