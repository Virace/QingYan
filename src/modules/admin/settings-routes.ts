import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError } from "../shared/errors";
import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import { adminSettingsBodySchema, adminSettingsQuerySchema } from "./schemas";
import { AdminSessionService } from "./session-service";

export const adminSettingsRoutes: FastifyPluginAsync = async (fastify) => {
	const repository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		repository,
	);
	const service = new AdminManagementService(
		fastify.security,
		fastify.siteRegistry,
		repository,
	);

	fastify.get("/", async (request) => {
		await sessionService.requireSession(request);
		const parsed = adminSettingsQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return service.getSettings(parsed.data.siteKey);
	});

	fastify.put("/", async (request) => {
		await sessionService.requireSession(request);
		const parsedQuery = adminSettingsQuerySchema.safeParse(request.query);
		const parsedBody = adminSettingsBodySchema.safeParse(request.body);
		if (!parsedQuery.success || !parsedBody.success) {
			throw new InvalidRequestError({
				issues: [
					...(parsedQuery.success ? [] : parsedQuery.error.issues),
					...(parsedBody.success ? [] : parsedBody.error.issues),
				],
			});
		}

		return service.updateSettings(parsedQuery.data.siteKey, parsedBody.data);
	});
};
