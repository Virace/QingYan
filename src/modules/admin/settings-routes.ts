import type { FastifyPluginAsync } from "fastify";

import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import {
	adminSectionPatchBodySchema,
	adminSettingsBodySchema,
	adminSiteSettingsSectionParamsSchema,
} from "./schemas";
import { AdminSessionService } from "./session-service";
import { requireSiteAccess } from "./authorization";
import { toValidationFields } from "./validation-fields";
import { ValidationFailedError } from "../shared/errors";

type SiteSettingsUpdateInput = Parameters<
	AdminManagementService["updateSettings"]
>[1];

export const adminSettingsRoutes: FastifyPluginAsync = async (fastify) => {
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

	fastify.patch("/:siteKey/sections/:section", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedParams = adminSiteSettingsSectionParamsSchema.safeParse(
			request.params,
		);
		const parsedBody = adminSectionPatchBodySchema.safeParse(request.body);
		if (!parsedParams.success || !parsedBody.success) {
			throw new ValidationFailedError(
				toValidationFields(
					[
						...(parsedParams.success ? [] : parsedParams.error.issues),
						...(parsedBody.success ? [] : parsedBody.error.issues),
					],
					{
						params: request.params,
						body: request.body,
					},
				),
			);
		}

		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsedParams.data.siteKey,
			permission: "site_settings.update",
		});

		const parsedSettings = adminSettingsBodySchema.safeParse({
			[parsedParams.data.section]: parsedBody.data,
		});
		if (!parsedSettings.success) {
			throw new ValidationFailedError(
				toValidationFields(parsedSettings.error.issues, {
					[parsedParams.data.section]: parsedBody.data,
				}),
			);
		}

		const updateInput: SiteSettingsUpdateInput = {
			...parsedSettings.data,
			requestId: request.context?.requestId,
			actorUserId: session.user.id,
		};
		return service.updateSettings(parsedParams.data.siteKey, updateInput);
	});
};
