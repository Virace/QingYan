import type { FastifyPluginAsync } from "fastify";

import { NotificationChainTestService } from "../notifications/notification-chain-test-service";
import { NotificationDiagnosticsService } from "../notifications/notification-diagnostics-service";
import { InvalidRequestError, ValidationFailedError } from "../shared/errors";
import { requirePermission, requireSiteAccess } from "./authorization";
import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import {
	adminNotificationChainTestBodySchema,
	adminNotificationChainTestParamsSchema,
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
	const notificationDiagnostics = new NotificationDiagnosticsService(
		fastify.db,
		{
			notificationRuntimeState: () => fastify.notificationRuntime.state(),
		},
	);
	const notificationChainTests = new NotificationChainTestService(fastify.db, {
		diagnostics: notificationDiagnostics,
		onTerminal: async (event) => {
			await fastify.security.writeAudit({
				siteKey: event.siteKey,
				actorType: event.actorUserId ? "admin_user" : "system",
				actorId: event.actorUserId ? String(event.actorUserId) : undefined,
				event:
					event.status === "passed"
						? "notification.chain_test.completed"
						: "notification.chain_test.failed",
				level: event.status === "passed" ? "info" : "warn",
				message:
					event.status === "passed"
						? "评论通知链路测试已通过"
						: event.status === "timed_out"
							? "评论通知链路测试已超时"
							: "评论通知链路测试失败",
				targetType: "notification_chain_test",
				targetId: event.runId,
				payload: {
					status: event.status,
					adminSentCount: event.adminSentCount,
					commenterSentCount: event.commenterSentCount,
				},
			});
		},
	});

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

	fastify.get("/:siteKey/notification-diagnostics", async (request) => {
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
		return notificationDiagnostics.diagnose(parsedParams.data.siteKey);
	});

	fastify.post("/:siteKey/notification-chain-tests", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedParams = adminSiteParamsSchema.safeParse(request.params);
		const parsedBody = adminNotificationChainTestBodySchema.safeParse(
			request.body,
		);
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
		const result = await notificationChainTests.start({
			siteKey: parsedParams.data.siteKey,
			commenterEmail: parsedBody.data.commenterEmail,
			actorUserId: session.user.id,
			requestId: request.context?.requestId,
		});
		await fastify.security.writeAudit({
			requestId: request.context?.requestId,
			siteKey: parsedParams.data.siteKey,
			actorType: "admin_user",
			actorId: String(session.user.id),
			event: "notification.chain_test.started",
			message: "评论通知链路测试已启动",
			targetType: "notification_chain_test",
			targetId: result.runId,
			payload: {
				status: result.status,
			},
		});
		return result;
	});

	fastify.get("/:siteKey/notification-chain-tests/:runId", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedParams = adminNotificationChainTestParamsSchema.safeParse(
			request.params,
		);
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
		return notificationChainTests.get(parsedParams.data);
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
