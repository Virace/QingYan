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
import { setPublicVisitorCookie } from "../shared/public-visitor-cookie";
import { DefaultCommentMetadataResolver } from "../comments/metadata/resolver";

function requireDevPageKey(pageKey?: string): string {
	if (!pageKey) {
		throw new InvalidRequestError();
	}

	return pageKey;
}

function requireDevPageUrl(pageUrl?: string): string {
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
	const systemSettingsService = new RuntimeSystemSettingsService(fastify.db);
	const metadataResolver =
		fastify.commentMetadataResolver ?? new DefaultCommentMetadataResolver();
	if (!fastify.commentMetadataResolver) {
		fastify.addHook("onClose", async () => {
			metadataResolver.close?.();
		});
	}
	const captchaService = new CaptchaService(
		fastify.config,
		fastify.security,
		commentsRepository,
		new CommentsWriteRepository(fastify.db),
		{
			getSettings: () => systemSettingsService.getCaptchaSettings(),
			getIpRegionSettings: () => systemSettingsService.getIpRegionSettings(),
		},
		metadataResolver,
	);
	const service = new PageFeedbackService(
		fastify.security,
		commentsRepository,
		captchaService,
		new PageFeedbackRepository(fastify.db),
		metadataResolver,
		() => systemSettingsService.getIpRegionSettings(),
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
				pageKey: requireDevPageKey(parsed.data.pageKey),
				pageUrl: requireDevPageUrl(parsed.data.pageUrl),
				visitorKey: request.context?.visitor?.key,
			});
			setPublicVisitorCookie({
				reply,
				visitorKey: result.visitorKey,
				path: visitorCookiePath,
			});

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
		setPublicVisitorCookie({
			reply,
			visitorKey: result.visitorKey,
			path: visitorCookiePath,
		});

		return result;
	});
};
