import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError } from "../shared/errors";
import { AdminRepository } from "./repository";
import { adminLoginBodySchema } from "./schemas";
import { AdminSessionService } from "./session-service";
import { qingyanCookiePath } from "../../config/public-path";

export const adminSessionRoutes: FastifyPluginAsync = async (fastify) => {
	const sessionCookiePath = qingyanCookiePath(fastify.config.server.publicPath);
	const service = new AdminSessionService(
		fastify.config,
		fastify.security,
		new AdminRepository(fastify.db),
		fastify.adminBootstrap,
		fastify.siteRegistry,
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
			username: parsed.data.username,
			password: parsed.data.password,
			ip: request.context?.ip,
			requestId: request.context?.requestId,
			userAgent: request.context?.userAgent,
		});
		reply.setCookie(service.getSessionCookieName(), result.sessionToken, {
			path: sessionCookiePath,
			sameSite: fastify.config.admin.session.sameSite,
			httpOnly: true,
			secure: fastify.config.admin.session.secure,
			maxAge: result.ttlMinutes * 60,
		});

		return {
			authenticated: true,
			session: {
				expiresAt: result.expiresAt,
			},
			csrf: {
				header: result.csrf.header,
				token: result.csrf.token,
			},
		};
	});

	fastify.post("/logout", async (request, reply) => {
		await service.logout(request);
		reply.clearCookie(service.getSessionCookieName(), {
			path: sessionCookiePath,
		});
		return {
			authenticated: false,
		};
	});

	fastify.get("/me", async (request) => service.getMe(request));
};
