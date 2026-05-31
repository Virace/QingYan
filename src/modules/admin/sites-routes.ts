import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError, ValidationFailedError } from "../shared/errors";
import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import {
	adminSettingsBodySchema,
	adminSiteCreateBodySchema,
	adminSiteParamsSchema,
	adminSitePatchBodySchema,
} from "./schemas";
import { AdminSessionService } from "./session-service";
import { toValidationFields } from "./validation-fields";

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

	fastify.patch("/:siteKey", async (request) => {
		await sessionService.requireSession(request);
		const parsedParams = adminSiteParamsSchema.safeParse(request.params);
		const parsedBody = adminSitePatchBodySchema.safeParse(request.body);
		if (!parsedParams.success || !parsedBody.success) {
			throw new InvalidRequestError({
				issues: [
					...(parsedParams.success ? [] : parsedParams.error.issues),
					...(parsedBody.success ? [] : parsedBody.error.issues),
				],
			});
		}

		return service.updateSite({
			siteKey: parsedParams.data.siteKey,
			...parsedBody.data,
			requestId: request.context?.requestId,
		});
	});

	fastify.get("/:siteKey/settings", async (request) => {
		await sessionService.requireSession(request);
		const parsedParams = adminSiteParamsSchema.safeParse(request.params);
		if (!parsedParams.success) {
			throw new InvalidRequestError({
				issues: parsedParams.error.issues,
			});
		}

		return service.getSettings(parsedParams.data.siteKey);
	});

	fastify.put("/:siteKey/settings", async (request) => {
		await sessionService.requireSession(request);
		const parsedParams = adminSiteParamsSchema.safeParse(request.params);
		const parsedBody = adminSettingsBodySchema.safeParse(request.body);
		if (!parsedParams.success) {
			throw new InvalidRequestError({
				issues: parsedParams.error.issues,
			});
		}
		if (!parsedBody.success) {
			throw new ValidationFailedError(
				toValidationFields(parsedBody.error.issues, request.body),
			);
		}

		return service.updateSettings(parsedParams.data.siteKey, {
			...parsedBody.data,
			requestId: request.context?.requestId,
		});
	});
};
