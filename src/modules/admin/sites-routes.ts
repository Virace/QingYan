import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError } from "../shared/errors";
import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import { adminSiteCreateBodySchema } from "./schemas";
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

	fastify.post("/", async (request) => {
		await sessionService.requireSession(request);
		const parsed = adminSiteCreateBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return service.createSite({
			...parsed.data,
			requestId: request.context?.requestId,
		});
	});
};
