import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError } from "../shared/errors";
import { RuntimeSystemSettingsService } from "../system-settings/service";
import { CaptchaService } from "./captcha-service";
import { CommentsRepository } from "./repository";
import { captchaCompleteBodySchema, captchaWidgetQuerySchema } from "./schemas";
import { CommentsWriteRepository } from "./write-repository";

export const captchaWidgetRoutes: FastifyPluginAsync = async (fastify) => {
	const repository = new CommentsRepository(fastify.db, fastify.siteRegistry);
	const systemSettingsService = new RuntimeSystemSettingsService(fastify.db);
	const captchaService = new CaptchaService(
		fastify.config,
		fastify.security,
		repository,
		new CommentsWriteRepository(fastify.db),
		{
			getSettings: () => systemSettingsService.getCaptchaSettings(),
			getIpRegionSettings: () => systemSettingsService.getIpRegionSettings(),
		},
	);

	fastify.get("/comments/captcha/widget", async (request, reply) => {
		const parsed = captchaWidgetQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		reply.type("text/html; charset=utf-8");
		return captchaService.getWidgetHtml({
			action: parsed.data.action,
			siteKey: parsed.data.siteKey,
			pageKey: parsed.data.pageKey,
			challengeId: parsed.data.challengeId,
			visitorKey: request.context?.visitor?.key,
			securityToken: request.context?.securityToken,
			ip: request.context?.ip,
			userAgent: request.context?.userAgent,
		});
	});

	fastify.post("/comments/captcha/complete", async (request) => {
		const parsed = captchaCompleteBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return captchaService.completeWidgetChallenge({
			action: parsed.data.action,
			siteKey: parsed.data.siteKey,
			pageKey: parsed.data.pageKey,
			challengeId: parsed.data.challengeId,
			token: parsed.data.token,
			lotNumber: parsed.data.lotNumber,
			captchaOutput: parsed.data.captchaOutput,
			passToken: parsed.data.passToken,
			genTime: parsed.data.genTime,
			requestId: request.context?.requestId,
			visitorKey: request.context?.visitor?.key,
			securityToken: request.context?.securityToken,
			ip: request.context?.ip,
			userAgent: request.context?.userAgent,
		});
	});
};
