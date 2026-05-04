import type { FastifyInstance } from "fastify";

import type { AppRuntimeOptions } from "../../config/runtime-options";
import { AdminRepository } from "../admin/repository";
import { AdminSessionService } from "../admin/session-service";
import { CaptchaService } from "../comments/captcha-service";
import { CommentsRepository } from "../comments/repository";
import { CommentsWriteRepository } from "../comments/write-repository";
import { InvalidRequestError } from "../shared/errors";
import { DevMockService } from "./mock-service";
import {
	devResetBodySchema,
	devScenarioBodySchema,
	devSessionBodySchema,
	devStateQuerySchema,
} from "./schemas";
import { DevModeService } from "./service";

export function registerDatabaseDevRoutes(
	app: FastifyInstance,
	runtimeOptions: AppRuntimeOptions,
): void {
	const defaultSite = runtimeOptions.devMode.defaultSite;
	const devMockService = defaultSite
		? new DevMockService(defaultSite)
		: undefined;
	app.decorate("devMockService", devMockService);

	const commentsRepository = new CommentsRepository(app.db, app.siteRegistry);
	const adminSessionService = new AdminSessionService(
		app.config,
		app.security,
		new AdminRepository(app.db),
		app.adminBootstrap,
		app.siteRegistry,
	);
	const devService = new DevModeService(
		app.db,
		commentsRepository,
		new CaptchaService(
			app.config,
			app.security,
			commentsRepository,
			new CommentsWriteRepository(app.db),
		),
		adminSessionService,
	);

	app.post("/api/dev/session", async (request, reply) => {
		const parsed = devSessionBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		const result = await adminSessionService.createDevSession({
			expectedToken: runtimeOptions.devMode.adminToken ?? "",
			devToken: parsed.data.token,
			ip: request.context?.ip,
			requestId: request.context?.requestId,
			userAgent: request.context?.userAgent,
		});
		reply.setCookie(
			adminSessionService.getSessionCookieName(),
			result.sessionToken,
			{
				path: "/",
				sameSite: app.config.admin.session.sameSite,
				httpOnly: true,
				secure: app.config.admin.session.secure,
			},
		);

		return {
			authenticated: true,
			session: {
				expiresAt: result.expiresAt,
			},
		};
	});

	app.get("/api/dev/state", async (request) => {
		await devService.requireAdminSession(request);
		const parsed = devStateQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		if (app.devMockService?.ownsSite(parsed.data.siteKey)) {
			return app.devMockService.inspect(
				parsed.data.siteKey,
				parsed.data.pageKey,
				parsed.data.visitorKey,
			);
		}

		return devService.inspect(
			parsed.data.siteKey,
			parsed.data.pageKey,
			parsed.data.visitorKey,
			{
				requestId: request.context?.requestId,
				ip: request.context?.ip,
				userAgent: request.context?.userAgent,
			},
		);
	});

	app.post("/api/dev/reset", async (request) => {
		await devService.requireAdminSession(request);
		const parsed = devResetBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		if (app.devMockService?.ownsSite(parsed.data.siteKey)) {
			return app.devMockService.resetPageState(
				parsed.data.siteKey,
				parsed.data.pageKey,
			);
		}

		return devService.resetPageState(parsed.data.siteKey, parsed.data.pageKey);
	});

	app.post("/api/dev/scenario", async (request) => {
		await devService.requireAdminSession(request);
		const parsed = devScenarioBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		if (app.devMockService?.ownsSite(parsed.data.siteKey)) {
			return app.devMockService.applyScenario(parsed.data);
		}

		return devService.applyScenario(parsed.data);
	});
}
