import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError } from "../shared/errors";
import { AdminRepository } from "./repository";
import { adminLoginBodySchema } from "./schemas";
import { AdminSessionService } from "./session-service";

export const adminSessionRoutes: FastifyPluginAsync = async (fastify) => {
	const service = new AdminSessionService(
		fastify.config,
		fastify.security,
		new AdminRepository(fastify.db),
	);

	fastify.get("/captcha", async (request) =>
		service.createCaptcha({
			ip: request.context?.ip,
			requestId: request.context?.requestId,
		}),
	);

	fastify.post("/login", async (request, reply) => {
		const parsed = adminLoginBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		const result = await service.login({
			captchaValue: parsed.data.captchaValue,
			challengeId: parsed.data.challengeId,
			token: parsed.data.token,
			ip: request.context?.ip,
			requestId: request.context?.requestId,
			userAgent: request.context?.userAgent,
		});
		reply.setCookie(service.getSessionCookieName(), result.sessionToken, {
			path: "/",
			sameSite: fastify.config.admin.session.sameSite,
			httpOnly: true,
			secure: fastify.config.admin.session.secure,
		});

		return {
			authenticated: true,
			session: {
				expiresAt: result.expiresAt,
			},
		};
	});

	fastify.post("/logout", async (request, reply) => {
		await service.logout(request);
		reply.clearCookie(service.getSessionCookieName(), {
			path: "/",
		});
		return {
			authenticated: false,
		};
	});

	fastify.get("/me", async (request) => service.getMe(request));
};
