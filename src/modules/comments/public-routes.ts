import type { FastifyPluginAsync } from "fastify";

import {
	AppError,
	InvalidRequestError,
	ResourceNotFoundError,
} from "../shared/errors";
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
import { buildCommentDisplayOptions, CommentsService } from "./service";
import { CaptchaService } from "./captcha-service";
import { DefaultCommentMetadataResolver } from "./metadata/resolver";
import { CommentsWriteRepository } from "./write-repository";
import { CommentsWriteService } from "./write-service";
import { RuntimeSystemSettingsService } from "../system-settings/service";
import { AdminRepository } from "../admin/repository";
import { AdminSessionService } from "../admin/session-service";
import { qingyanCookiePath } from "../../config/public-path";
import { ModerationService } from "./moderation-service";
import { AkismetClient } from "./akismet-client";
import { resolvePublicPageContext } from "../shared/page-context";
import { setPublicVisitorCookie } from "../shared/public-visitor-cookie";
import {
	mergeStaffDisplaySettings,
	mergeVerifiedAuthorSettings,
} from "./verified-author";

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

export const commentsPublicRoutes: FastifyPluginAsync = async (fastify) => {
	const visitorCookiePath = qingyanCookiePath(fastify.config.server.publicPath);
	const readRepository = new CommentsRepository(
		fastify.db,
		fastify.siteRegistry,
	);
	const adminRepository = new AdminRepository(fastify.db);
	const adminSessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		adminRepository,
		fastify.adminBootstrap,
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
	const moderationService = new ModerationService({
		akismetClient: fastify.akismetClient ?? new AkismetClient(),
		loadSystemSettings: () => systemSettingsService.getSettings(),
	});
	fastify.addHook("onClose", async () => {
		metadataResolver.close();
	});
	const readService = new CommentsService(
		readRepository,
		captchaService,
		() => systemSettingsService.getAvatarSettings(),
		() => systemSettingsService.getPublicApiSettings(),
	);
	const writeService = new CommentsWriteService(
		fastify.config,
		fastify.security,
		readRepository,
		writeRepository,
		captchaService,
		metadataResolver,
		() => systemSettingsService.getIpRegionSettings(),
		moderationService,
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
				pageKey: requireDevPageKey(parsed.data.pageKey),
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
		const adminSession = await adminSessionService.getOptionalSession(request);
		const result = await readService.getBootstrap({
			...parsed.data,
			...pageContext,
			visitorKey: request.context?.visitor?.key,
			ip: request.context?.ip,
			userAgent: request.context?.userAgent,
			verifiedAuthorSession: adminSession ? { type: "admin" } : undefined,
		});
		setPublicVisitorCookie({
			reply,
			visitorKey: result.visitorKey,
			path: visitorCookiePath,
		});

		return {
			capability: result.capability,
			commentForm: result.commentForm,
			pagination: result.pagination,
			comments: presentComments(
				result.commentBundle.comments,
				result.commentBundle.viewerVoteMap,
				result.commentDisplay,
			),
			commentDisplay: result.publicCommentDisplay,
			viewer: result.viewer,
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
				pageKey: requireDevPageKey(parsed.data.pageKey),
				pageTitle: undefined,
				pageUrl: undefined,
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
		});
		const result = await readService.getThread({
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

		return {
			pagination: result.pagination,
			comments: presentComments(
				result.commentBundle.comments,
				result.commentBundle.viewerVoteMap,
				result.commentDisplay,
			),
			commentDisplay: result.publicCommentDisplay,
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
				pageKey: requireDevPageKey(parsed.data.pageKey),
				pageTitle: parsed.data.pageTitle,
				pageUrl: requireDevPageUrl(parsed.data.pageUrl),
				parentCommentId: parsed.data.parentCommentId,
				author: parsed.data.author,
				contentRaw: parsed.data.content.raw,
				captcha: parsed.data.captcha,
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
		const adminSession = await adminSessionService.getOptionalSession(request);
		const result = await writeService.createComment({
			siteKey: pageContext.siteKey,
			pageKey: pageContext.pageKey,
			pageTitle: parsed.data.pageTitle,
			pageUrl: pageContext.pageUrl,
			parentCommentId: parsed.data.parentCommentId,
			author: parsed.data.author,
			contentRaw: parsed.data.content.raw,
			captcha: parsed.data.captcha,
			requestId: request.context?.requestId,
			visitorKey: request.context?.visitor?.key,
			ip: request.context?.ip,
			userAgent: request.context?.userAgent,
			verifiedAuthorSession: adminSession ? { type: "admin" } : undefined,
		});
		setPublicVisitorCookie({
			reply,
			visitorKey: result.visitorKey,
			path: visitorCookiePath,
		});
		const settings = await readRepository.getSiteSettings(pageContext.site.id);
		const avatarSettings = await systemSettingsService.getAvatarSettings();
		const [presentedComment] = presentComments(
			[
				{
					...result.createdComment,
					status: result.comment.status,
				},
			],
			new Map(),
			buildCommentDisplayOptions({
				metadata: readRepository.resolveCommentMetadata(settings ?? undefined),
				avatar: avatarSettings,
				verifiedAuthor: mergeVerifiedAuthorSettings(
					settings?.verifiedAuthorJson,
				),
				staffDisplay: mergeStaffDisplaySettings(settings?.staffDisplayJson),
			}),
		);
		if (!presentedComment) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}

		return {
			comment: presentedComment,
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
				pageKey: requireDevPageKey(parsedBody.data.pageKey),
				commentId: parsedParams.data.commentId,
				choice: parsedBody.data.choice,
				captcha: parsedBody.data.captcha,
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
			siteKey: parsedBody.data.siteKey,
		});
		const result = await writeService.castVote({
			commentId: parsedParams.data.commentId,
			siteKey: pageContext.siteKey,
			pageKey: pageContext.pageKey,
			choice: parsedBody.data.choice,
			captcha: parsedBody.data.captcha,
			requestId: request.context?.requestId,
			visitorKey: request.context?.visitor?.key,
			ip: request.context?.ip,
			userAgent: request.context?.userAgent,
		});
		setPublicVisitorCookie({
			reply,
			visitorKey: result.visitorKey,
			path: visitorCookiePath,
		});

		return {
			commentId: result.commentId,
			voteUp: result.voteUp,
			voteDown: result.voteDown,
			viewerVote: result.viewerVote,
			trustMode: result.trustMode,
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
				pageKey: requireDevPageKey(parsed.data.pageKey),
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
		const result = await captchaService.getState({
			...parsed.data,
			...pageContext,
			requestId: request.context?.requestId,
			visitorKey: request.context?.visitor?.key,
			ip: request.context?.ip,
			userAgent: request.context?.userAgent,
		});
		setPublicVisitorCookie({
			reply,
			visitorKey: result.visitorKey,
			path: visitorCookiePath,
		});

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
				pageKey: requireDevPageKey(parsed.data.pageKey),
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
		const result = await captchaService.refreshState({
			...parsed.data,
			...pageContext,
			requestId: request.context?.requestId,
			visitorKey: request.context?.visitor?.key,
			ip: request.context?.ip,
			userAgent: request.context?.userAgent,
		});
		setPublicVisitorCookie({
			reply,
			visitorKey: result.visitorKey,
			path: visitorCookiePath,
		});

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
				pageKey: requireDevPageKey(parsed.data.pageKey),
				challengeId: parsed.data.challengeId,
				value: parsed.data.value,
				visitorKey: request.context?.visitor?.key,
			});
			return result.body;
		}

		const pageContext = resolvePublicPageContext({
			siteRegistry: fastify.siteRegistry,
			request,
			siteKey: parsed.data.siteKey,
		});
		return captchaService.verify({
			...parsed.data,
			...pageContext,
			requestId: request.context?.requestId,
			visitorKey: request.context?.visitor?.key,
			ip: request.context?.ip,
			userAgent: request.context?.userAgent,
			checkRateLimit: async (identityKey) => {
				const rule = await fastify.security.getRateLimitRule("captchaVerify");
				const snapshot = fastify.security.peekRateLimit({
					key: `public:${pageContext.siteKey}:${identityKey}:captcha_verify`,
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
					key: `public:${pageContext.siteKey}:${identityKey}:captcha_verify`,
					rule: await fastify.security.getRateLimitRule("captchaVerify"),
					errorCode: "COMMENT_RATE_LIMITED",
					errorMessage: "验证码尝试次数过多，请稍后再试。",
				});
			},
		});
	});
};
