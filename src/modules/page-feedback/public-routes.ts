import type { FastifyPluginAsync } from "fastify";

import { CommentsRepository } from "../comments/repository";
import { CommentsWriteRepository } from "../comments/write-repository";
import { CaptchaService } from "../comments/captcha-service";
import { InvalidRequestError } from "../shared/errors";
import { PageFeedbackRepository } from "./repository";
import { pageLikeBodySchema } from "./schemas";
import { PageFeedbackService } from "./service";

export const pageFeedbackPublicRoutes: FastifyPluginAsync = async (fastify) => {
	const commentsRepository = new CommentsRepository(
		fastify.db,
		fastify.siteRegistry,
	);
	const captchaService = new CaptchaService(
		fastify.config,
		fastify.security,
		commentsRepository,
		new CommentsWriteRepository(fastify.db),
	);
	const service = new PageFeedbackService(
		fastify.config,
		fastify.security,
		commentsRepository,
		captchaService,
		new PageFeedbackRepository(fastify.db),
	);

	fastify.post("/page-feedback/like", async (request, reply) => {
		const parsed = pageLikeBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		if (fastify.devMockService?.ownsSite(parsed.data.siteKey)) {
			const result = await fastify.devMockService.likePage({
				...parsed.data,
				visitorKey: request.context?.visitor?.key,
			});
			if (result.visitorKey) {
				reply.setCookie("qingyan_visitor", result.visitorKey, {
					path: "/",
					sameSite: "lax",
					httpOnly: true,
				});
			}

			return result.body;
		}

		const result = await service.likePage({
			...parsed.data,
			visitorKey: request.context?.visitor?.key,
			ip: request.context?.ip,
			userAgent: request.context?.userAgent,
		});
		if (result.visitorKey) {
			reply.setCookie("qingyan_visitor", result.visitorKey, {
				path: "/",
				sameSite: "lax",
				httpOnly: true,
			});
		}

		return result;
	});
};
