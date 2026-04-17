import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError } from "../shared/errors";
import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import {
	adminBlacklistBodySchema,
	adminBlacklistParamsSchema,
	adminBlacklistQuerySchema,
} from "./schemas";
import { AdminSessionService } from "./session-service";

export const adminBlacklistRoutes: FastifyPluginAsync = async (fastify) => {
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
		const parsed = adminBlacklistQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return {
			items: await service.listBlacklist(parsed.data.siteKey),
		};
	});

	fastify.post("/", async (request) => {
		await sessionService.requireSession(request);
		const parsed = adminBlacklistBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return {
			rule: await service.createBlacklist({
				...parsed.data,
				requestId: request.context?.requestId,
			}),
		};
	});

	fastify.delete("/:ruleId", async (request) => {
		await sessionService.requireSession(request);
		const parsed = adminBlacklistParamsSchema.safeParse(request.params);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return {
			rule: await service.deleteBlacklist(
				parsed.data.ruleId,
				request.context?.requestId,
			),
		};
	});
};
