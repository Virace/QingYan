import type { FastifyPluginAsync } from "fastify";

import { AppError, InvalidRequestError } from "../shared/errors";
import { presentComments } from "./presenter";
import { CommentsRepository } from "./repository";
import {
	bootstrapQuerySchema,
	captchaRefreshBodySchema,
	captchaStateQuerySchema,
	captchaVerifyBodySchema,
	createCommentBodySchema,
	threadQuerySchema,
	voteCommentBodySchema,
	voteCommentParamsSchema,
} from "./schemas";
import { CommentsService } from "./service";
import { CaptchaService } from "./captcha-service";
import { DefaultCommentMetadataResolver } from "./metadata/resolver";
import { CommentsWriteRepository } from "./write-repository";
import { CommentsWriteService } from "./write-service";
import { RuntimeSystemSettingsService } from "../system-settings/service";

export const commentsPublicRoutes: FastifyPluginAsync = async (fastify) => {
	const readRepository = new CommentsRepository(
		fastify.db,
		fastify.siteRegistry,
	);
	const writeRepository = new CommentsWriteRepository(fastify.db);
	const captchaService = new CaptchaService(
		fastify.config,
		fastify.security,
		readRepository,
		writeRepository,
		{
			getSettings: () =>
				new RuntimeSystemSettingsService(fastify.db).getCaptchaSettings(),
		},
	);
	const systemSettingsService = new RuntimeSystemSettingsService(fastify.db);
	const metadataResolver = new DefaultCommentMetadataResolver();
	fastify.addHook("onClose", async () => {
		metadataResolver.close();
	});
	const readService = new CommentsService(readRepository, captchaService, () =>
		systemSettingsService.getAvatarSettings(),
	);
	const writeService = new CommentsWriteService(
		fastify.config,
		fastify.security,
		readRepository,
		writeRepository,
		captchaService,
		metadataResolver,
		() => systemSettingsService.getIpRegionSettings(),
	);

	fastify.get("/comments/bootstrap", async (request, reply) => {
		const parsed = bootstrapQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		if (fastify.devMockService?.ownsSite(parsed.data.siteKey)) {
			const result = await fastify.devMockService.getBootstrap({
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

		const result = await readService.getBootstrap({
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

		return {
			capability: result.capability,
			commentForm: result.commentForm,
			thread: {
				siteKey: parsed.data.siteKey,
				pageKey: result.thread.pageKey,
				pageTitle: result.thread.pageTitle,
			},
			pagination: result.pagination,
			comments: presentComments(
				result.commentBundle.comments,
				result.commentBundle.viewerVoteMap,
				result.commentDisplay,
			),
			pageMetrics: result.pageMetrics,
			pageFeedback: result.pageFeedback,
			captcha: result.captcha,
		};
	});

	fastify.get("/comments/thread", async (request, reply) => {
		const parsed = threadQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		if (fastify.devMockService?.ownsSite(parsed.data.siteKey)) {
			const result = await fastify.devMockService.getThread({
				...parsed.data,
				pageTitle: undefined,
				pageUrl: undefined,
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

		const result = await readService.getThread({
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

		return {
			thread: {
				siteKey: parsed.data.siteKey,
				pageKey: result.thread.pageKey,
				pageTitle: result.thread.pageTitle,
			},
			pagination: result.pagination,
			comments: presentComments(
				result.commentBundle.comments,
				result.commentBundle.viewerVoteMap,
				result.commentDisplay,
			),
		};
	});

	fastify.post("/comments", async (request, reply) => {
		const parsed = createCommentBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		if (fastify.devMockService?.ownsSite(parsed.data.siteKey)) {
			const result = await fastify.devMockService.createComment({
				siteKey: parsed.data.siteKey,
				pageKey: parsed.data.pageKey,
				pageTitle: parsed.data.pageTitle,
				pageUrl: parsed.data.pageUrl,
				parentCommentId: parsed.data.parentCommentId,
				author: parsed.data.author,
				contentRaw: parsed.data.content.raw,
				captcha: parsed.data.captcha,
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

		const result = await writeService.createComment({
			siteKey: parsed.data.siteKey,
			pageKey: parsed.data.pageKey,
			pageTitle: parsed.data.pageTitle,
			pageUrl: parsed.data.pageUrl,
			parentCommentId: parsed.data.parentCommentId,
			author: parsed.data.author,
			contentRaw: parsed.data.content.raw,
			captcha: parsed.data.captcha,
			requestId: request.context?.requestId,
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

		return {
			comment: result.comment,
			thread: result.thread,
		};
	});

	fastify.post("/comments/:commentId/vote", async (request, reply) => {
		const parsedParams = voteCommentParamsSchema.safeParse(request.params);
		const parsedBody = voteCommentBodySchema.safeParse(request.body);
		if (!parsedParams.success || !parsedBody.success) {
			throw new InvalidRequestError({
				issues: [
					...(parsedParams.success ? [] : parsedParams.error.issues),
					...(parsedBody.success ? [] : parsedBody.error.issues),
				],
			});
		}

		if (fastify.devMockService?.ownsSite(parsedBody.data.siteKey)) {
			const result = await fastify.devMockService.castVote({
				siteKey: parsedBody.data.siteKey,
				pageKey: parsedBody.data.pageKey,
				commentId: parsedParams.data.commentId,
				choice: parsedBody.data.choice,
				captcha: parsedBody.data.captcha,
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

		const result = await writeService.castVote({
			commentId: parsedParams.data.commentId,
			siteKey: parsedBody.data.siteKey,
			pageKey: parsedBody.data.pageKey,
			choice: parsedBody.data.choice,
			captcha: parsedBody.data.captcha,
			requestId: request.context?.requestId,
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

		return {
			commentId: result.commentId,
			voteUp: result.voteUp,
			voteDown: result.voteDown,
			viewerVote: result.viewerVote,
		};
	});

	fastify.get("/comments/captcha/state", async (request, reply) => {
		const parsed = captchaStateQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		if (fastify.devMockService?.ownsSite(parsed.data.siteKey)) {
			const result = await fastify.devMockService.getCaptchaState({
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

		const result = await captchaService.getState({
			...parsed.data,
			requestId: request.context?.requestId,
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

		return {
			required: result.required,
			verified: result.verified,
			mode: result.mode,
			challenge: result.challenge,
		};
	});

	fastify.post("/comments/captcha/refresh", async (request, reply) => {
		const parsed = captchaRefreshBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		if (fastify.devMockService?.ownsSite(parsed.data.siteKey)) {
			const result = await fastify.devMockService.refreshCaptcha({
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

		const result = await captchaService.refreshState({
			...parsed.data,
			requestId: request.context?.requestId,
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

		return {
			required: result.required,
			verified: result.verified,
			mode: result.mode,
			challenge: result.challenge,
		};
	});

	fastify.post("/comments/captcha/verify", async (request) => {
		const parsed = captchaVerifyBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		if (fastify.devMockService?.ownsSite(parsed.data.siteKey)) {
			const result = await fastify.devMockService.verifyCaptcha({
				siteKey: parsed.data.siteKey,
				pageKey: parsed.data.pageKey,
				challengeId: parsed.data.challengeId,
				value: parsed.data.value,
				visitorKey: request.context?.visitor?.key,
			});
			return result.body;
		}

		return captchaService.verify({
			...parsed.data,
			requestId: request.context?.requestId,
			visitorKey: request.context?.visitor?.key,
			ip: request.context?.ip,
			userAgent: request.context?.userAgent,
			checkRateLimit: (identityKey) => {
				const rule = fastify.config.security.rateLimit.captchaVerify;
				const snapshot = fastify.security.peekRateLimit({
					key: `public:${parsed.data.siteKey}:${identityKey}:captcha_verify`,
					rule,
				});
				if (snapshot.limit !== null && snapshot.count >= snapshot.limit) {
					throw new AppError(
						429,
						"COMMENT_RATE_LIMITED",
						"验证码尝试次数过多，请稍后再试。",
						{
							resetAt: snapshot.resetAt,
						},
					);
				}
			},
			consumeRateLimit: async (identityKey) => {
				await fastify.security.consumeRateLimit({
					key: `public:${parsed.data.siteKey}:${identityKey}:captcha_verify`,
					rule: fastify.config.security.rateLimit.captchaVerify,
					errorCode: "COMMENT_RATE_LIMITED",
					errorMessage: "验证码尝试次数过多，请稍后再试。",
				});
			},
		});
	});
};
