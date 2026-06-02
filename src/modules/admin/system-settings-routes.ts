import type { FastifyPluginAsync } from "fastify";

import { ValidationFailedError } from "../shared/errors";
import {
	adminNotificationChannelTestBodySchema,
	adminSystemSettingsBodySchema,
} from "./schemas";
import { AdminRepository } from "./repository";
import { AdminSessionService } from "./session-service";
import { requirePermission } from "./authorization";
import { AdminSystemSettingsRepository } from "./system-settings-repository";
import {
	AdminSystemSettingsService,
	createAdminSystemSettingsDefaults,
} from "./system-settings-service";
import { toValidationFields } from "./validation-fields";
import { DatabaseTaskQueue } from "../tasks/database-task-queue";
import { TaskRunRepository } from "../tasks/task-run-repository";
import { NotificationChannelTestService } from "../notifications/channel-test-service";
import {
	type NotificationChannelConfigInput,
	NotificationChannelConfigsRepository,
} from "../notifications/channel-configs-repository";

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
	const channelConfigs = new NotificationChannelConfigsRepository(fastify.db);

	fastify.get("/", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "system_settings.read");
		const settings = await service.getSettings();
		return {
			...settings,
			notifications: {
				...settings.notifications,
				channelConfigs: await channelConfigs.list(),
			},
		};
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

		const { channelConfigs: nextChannelConfigs, ...notifications } =
			parsed.data.notifications ?? {};
		if (nextChannelConfigs) {
			await channelConfigs.replacePersisted(
				nextChannelConfigs.filter(
					(config) => config.type !== "email",
				) as NotificationChannelConfigInput[],
			);
		}
		const settings = await service.updateSettings({
			...parsed.data,
			notifications:
				parsed.data.notifications === undefined ? undefined : notifications,
			requestId: request.context?.requestId,
			actorUserId: session.user.id,
		});
		return {
			...settings,
			notifications: {
				...settings.notifications,
				channelConfigs: await channelConfigs.list(),
			},
		};
	});

	fastify.post("/notifications/channel-test", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "system_settings.update");
		const parsed = adminNotificationChannelTestBodySchema.safeParse(
			request.body,
		);
		if (!parsed.success) {
			throw new ValidationFailedError(
				toValidationFields(parsed.error.issues, request.body),
			);
		}

		const taskRepository = new TaskRunRepository(fastify.db);
		const channelTest = new NotificationChannelTestService(
			new DatabaseTaskQueue(fastify.db),
			taskRepository,
			channelConfigs,
		);
		return channelTest.enqueue({
			...parsed.data,
			session,
		});
	});
};
