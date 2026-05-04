import type { FastifyPluginAsync } from "fastify";

import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import { AdminSessionService } from "./session-service";

export const adminSitesRoutes: FastifyPluginAsync = async (fastify) => {
	const repository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		repository,
		fastify.adminBootstrap,
	);
	const service = new AdminManagementService(
		fastify.security,
		fastify.siteRegistry,
		repository,
	);

	fastify.get("/", async (request) => {
		await sessionService.requireSession(request);
		return service.listSitesSummary();
	});
};
