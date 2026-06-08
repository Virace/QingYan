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
import { requirePermission, requireSiteAccess } from "./authorization";
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
		const session = await sessionService.requireSession(request);
		requirePermission(session, "sites.read");
		return service.listSitesSummary();
	});

	fastify.post("/", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "sites.create");
		const parsed = adminSiteCreateBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return service.createSite({
			...parsed.data,
			requestId: request.context?.requestId,
			actorUserId: session.user.id,
		});
	});

	fastify.patch("/:siteKey", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "sites.update");
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
			actorUserId: session.user.id,
		});
	});

	fastify.get("/:siteKey/settings", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedParams = adminSiteParamsSchema.safeParse(request.params);
		if (!parsedParams.success) {
			throw new InvalidRequestError({
				issues: parsedParams.error.issues,
			});
		}

		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsedParams.data.siteKey,
			permission: "site_settings.read",
		});
		return service.getSettings(parsedParams.data.siteKey);
	});

	fastify.put("/:siteKey/settings", async (request) => {
		const session = await sessionService.requireSession(request);
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

		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsedParams.data.siteKey,
			permission: "site_settings.update",
		});
		return service.updateSettings(parsedParams.data.siteKey, {
			...parsedBody.data,
			requestId: request.context?.requestId,
			actorUserId: session.user.id,
		});
	});
};
