import type { FastifyPluginAsync } from "fastify";

import { NotificationTemplateAdminService } from "../notifications/templates/admin-service";
import { NotificationTemplateRepository } from "../notifications/templates/repository";
import { ResourceNotFoundError, ValidationFailedError } from "../shared/errors";
import { TaskRunRepository } from "../tasks/task-run-repository";
import { requirePermission } from "./authorization";
import {
	adminNotificationTemplateBodySchema,
	adminNotificationTemplatePreviewBodySchema,
	adminNotificationTemplateTestBodySchema,
} from "./schemas";
import { AdminRepository } from "./repository";
import { AdminSessionService } from "./session-service";
import { toValidationFields } from "./validation-fields";

export const adminNotificationTemplateRoutes: FastifyPluginAsync = async (
	fastify,
) => {
	const repository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		repository,
		fastify.adminBootstrap,
	);
	const service = new NotificationTemplateAdminService(
		new NotificationTemplateRepository(fastify.db),
		new TaskRunRepository(fastify.db),
	);

	fastify.get("/", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "system_settings.read");
		return { templates: await service.list() };
	});

	fastify.put("/:templateKey", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "system_settings.update");
		const parsed = adminNotificationTemplateBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new ValidationFailedError(
				toValidationFields(parsed.error.issues, request.body),
			);
		}
		const template = await service.update({
			key: (request.params as { templateKey: string }).templateKey,
			...parsed.data,
			updatedByUserId: session.user.id,
		});
		if (!template) {
			throw new ResourceNotFoundError(
				"NOTIFICATION_TEMPLATE_NOT_FOUND",
				"通知模板不存在。",
			);
		}
		return { template };
	});

	fastify.post("/:templateKey/preview", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "system_settings.read");
		const parsed = adminNotificationTemplatePreviewBodySchema.safeParse(
			request.body,
		);
		if (!parsed.success) {
			throw new ValidationFailedError(
				toValidationFields(parsed.error.issues, request.body),
			);
		}
		const rendered = await service.preview({
			key: (request.params as { templateKey: string }).templateKey,
			...parsed.data,
		});
		if (!rendered) {
			throw new ResourceNotFoundError(
				"NOTIFICATION_TEMPLATE_NOT_FOUND",
				"通知模板不存在。",
			);
		}
		return { rendered };
	});

	fastify.post("/:templateKey/restore-default", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "system_settings.update");
		const template = await service.restoreDefault(
			(request.params as { templateKey: string }).templateKey,
		);
		if (!template) {
			throw new ResourceNotFoundError(
				"NOTIFICATION_TEMPLATE_NOT_FOUND",
				"通知模板不存在。",
			);
		}
		return { template };
	});

	fastify.post("/:templateKey/test-send", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "system_settings.update");
		const parsed = adminNotificationTemplateTestBodySchema.safeParse(
			request.body,
		);
		if (!parsed.success) {
			throw new ValidationFailedError(
				toValidationFields(parsed.error.issues, request.body),
			);
		}
		const result = await service.test({
			key: (request.params as { templateKey: string }).templateKey,
			recipient: parsed.data.recipient ?? session.user.email,
			actorUserId: session.user.id,
		});
		if (!result) {
			throw new ResourceNotFoundError(
				"NOTIFICATION_TEMPLATE_NOT_FOUND",
				"通知模板不存在。",
			);
		}
		return result;
	});
};
