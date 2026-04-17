import type { FastifyPluginAsync } from "fastify";

import { AppError, InvalidRequestError } from "../shared/errors";
import { presentComments } from "./presenter";
import { CommentsRepository } from "./repository";
import {
	bootstrapQuerySchema,
	captchaStateQuerySchema,
	captchaVerifyBodySchema,
	createCommentBodySchema,
	threadQuerySchema,
	voteCommentBodySchema,
	voteCommentParamsSchema,
} from "./schemas";
import { CommentsService } from "./service";
import { CaptchaService } from "./captcha-service";
import { CommentsWriteRepository } from "./write-repository";
import { CommentsWriteService } from "./write-service";

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
	);
	const readService = new CommentsService(readRepository, captchaService);
	const writeService = new CommentsWriteService(
		fastify.config,
		fastify.security,
		readRepository,
		writeRepository,
		captchaService,
	);

	fastify.get("/comments/bootstrap", async (request, reply) => {
		const parsed = bootstrapQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
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

		const result = await writeService.createComment({
			siteKey: parsed.data.siteKey,
			pageKey: parsed.data.pageKey,
			pageTitle: parsed.data.pageTitle,
			pageUrl: parsed.data.pageUrl,
			parentCommentId: parsed.data.parentCommentId,
			author: parsed.data.author,
			contentRaw: parsed.data.content.raw,
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

		const result = await writeService.castVote({
			commentId: parsedParams.data.commentId,
			siteKey: parsedBody.data.siteKey,
			pageKey: parsedBody.data.pageKey,
			choice: parsedBody.data.choice,
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

	fastify.post("/comments/captcha/verify", async (request) => {
		const parsed = captchaVerifyBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
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
