import type { FastifyPluginAsync } from "fastify";

import { CommentsRepository } from "../comments/repository";
import { CommentsWriteRepository } from "../comments/write-repository";
import { CaptchaService } from "../comments/captcha-service";
import { InvalidRequestError } from "../shared/errors";
import { PageFeedbackRepository } from "./repository";
import { pageLikeBodySchema } from "./schemas";
import { PageFeedbackService } from "./service";
import { RuntimeSystemSettingsService } from "../system-settings/service";
import { qingyanCookiePath } from "../../config/public-path";
import { resolvePublicPageContext } from "../shared/page-context";

function requireLegacyPageKey(pageKey?: string): string {
	if (!pageKey) {
		throw new InvalidRequestError();
	}

	return pageKey;
}

function requireLegacyPageUrl(pageUrl?: string): string {
	if (!pageUrl) {
		throw new InvalidRequestError();
	}

	return pageUrl;
}

export const pageFeedbackPublicRoutes: FastifyPluginAsync = async (fastify) => {
	const visitorCookiePath = qingyanCookiePath(fastify.config.server.publicPath);
	const commentsRepository = new CommentsRepository(
		fastify.db,
		fastify.siteRegistry,
	);
	const captchaService = new CaptchaService(
		fastify.config,
		fastify.security,
		commentsRepository,
		new CommentsWriteRepository(fastify.db),
		{
			getSettings: () =>
				new RuntimeSystemSettingsService(fastify.db).getCaptchaSettings(),
		},
	);
	const service = new PageFeedbackService(
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
				pageKey: requireLegacyPageKey(parsed.data.pageKey),
				pageUrl: requireLegacyPageUrl(parsed.data.pageUrl),
				visitorKey: request.context?.visitor?.key,
			});
			if (result.visitorKey) {
				reply.setCookie("qingyan_visitor", result.visitorKey, {
					path: visitorCookiePath,
					sameSite: "lax",
					httpOnly: true,
				});
			}

			return result.body;
		}

		const pageContext = resolvePublicPageContext({
			siteRegistry: fastify.siteRegistry,
			request,
			siteKey: parsed.data.siteKey,
			pageTitle: parsed.data.pageTitle,
		});
		const result = await service.likePage({
			...parsed.data,
			...pageContext,
			visitorKey: request.context?.visitor?.key,
			ip: request.context?.ip,
			userAgent: request.context?.userAgent,
		});
		if (result.visitorKey) {
			reply.setCookie("qingyan_visitor", result.visitorKey, {
				path: visitorCookiePath,
				sameSite: "lax",
				httpOnly: true,
			});
		}

		return result;
	});
};
