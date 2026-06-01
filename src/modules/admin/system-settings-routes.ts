import type { FastifyPluginAsync } from "fastify";

import { ValidationFailedError } from "../shared/errors";
import { adminSystemSettingsBodySchema } from "./schemas";
import { AdminRepository } from "./repository";
import { AdminSessionService } from "./session-service";
import { requirePermission } from "./authorization";
import { AdminSystemSettingsRepository } from "./system-settings-repository";
import {
	AdminSystemSettingsService,
	createAdminSystemSettingsDefaults,
} from "./system-settings-service";
import { toValidationFields } from "./validation-fields";

export const adminSystemSettingsRoutes: FastifyPluginAsync = async (
	fastify,
) => {
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		new AdminRepository(fastify.db),
		fastify.adminBootstrap,
	);
	const service = new AdminSystemSettingsService(
		new AdminSystemSettingsRepository(fastify.db),
		fastify.loggerManager,
		createAdminSystemSettingsDefaults(fastify.config),
	);

	fastify.get("/", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "system_settings.read");
		return service.getSettings();
	});

	fastify.put("/", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "system_settings.update");
		const parsed = adminSystemSettingsBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new ValidationFailedError(
				toValidationFields(parsed.error.issues, request.body),
			);
		}

		return service.updateSettings({
			...parsed.data,
			requestId: request.context?.requestId,
			actorUserId: session.user.id,
		});
	});
};
