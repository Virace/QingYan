import type { FastifyPluginAsync } from "fastify";

import type { AppRuntimeOptions } from "../../config/runtime-options";
import {
	bootstrapQuerySchema,
	captchaRefreshBodySchema,
	captchaStateQuerySchema,
	captchaVerifyBodySchema,
	createCommentBodySchema,
	threadQuerySchema,
	voteCommentBodySchema,
	voteCommentParamsSchema,
} from "../comments/schemas";
import { pageLikeBodySchema } from "../page-feedback/schemas";
import {
	assertParsed,
	buildSiteSummary,
	DevMemorySessionStore,
	setVisitorCookie,
} from "./memory-route-support";
import type { DevMockService } from "./mock-service";
import {
	devResetBodySchema,
	devScenarioBodySchema,
	devSessionBodySchema,
	devStateQuerySchema,
} from "./schemas";

export function createDevMemoryRoutes(input: {
	devMockService: DevMockService;
	runtimeOptions: AppRuntimeOptions;
}): FastifyPluginAsync {
	const sessions = new DevMemorySessionStore(input.runtimeOptions);

	return async (fastify) => {
		const defaultSite = input.runtimeOptions.devMode.defaultSite;
		if (!defaultSite) {
			throw new Error("Dev memory mode requires a default site.");
		}

		fastify.post("/api/dev/session", async (request, reply) => {
			const parsed = assertParsed(devSessionBodySchema.safeParse(request.body));
			const session = sessions.create(parsed.token);
			reply.setCookie(sessions.getCookieName(), session.sessionToken, {
				path: "/",
				sameSite: fastify.config.admin.session.sameSite,
				httpOnly: true,
				secure: fastify.config.admin.session.secure,
			});

			return {
				authenticated: true,
				session: { expiresAt: session.expiresAt },
			};
		});

		fastify.get("/api/admin/session/me", async (request) => {
			const session = sessions.require(request);
			return {
				authenticated: true,
				session: { expiresAt: session.expiresAt },
				sites: [{ siteKey: defaultSite.siteKey, name: defaultSite.name }],
			};
		});

		fastify.post("/api/admin/session/logout", async (request, reply) => {
			sessions.delete(request);
			reply.clearCookie(sessions.getCookieName(), { path: "/" });
			return { authenticated: false };
		});

		fastify.get("/api/admin/sites", async (request) => {
			sessions.require(request);
			return { items: [buildSiteSummary(defaultSite)] };
		});

		fastify.get("/api/dev/state", async (request) => {
			sessions.require(request);
			const parsed = assertParsed(devStateQuerySchema.safeParse(request.query));
			return input.devMockService.inspect(
				parsed.siteKey,
				parsed.pageKey,
				parsed.visitorKey,
			);
		});

		fastify.post("/api/dev/reset", async (request) => {
			sessions.require(request);
			const parsed = assertParsed(devResetBodySchema.safeParse(request.body));
			return input.devMockService.resetPageState(
				parsed.siteKey,
				parsed.pageKey,
			);
		});

		fastify.post("/api/dev/scenario", async (request) => {
			sessions.require(request);
			const parsed = assertParsed(
				devScenarioBodySchema.safeParse(request.body),
			);
			return input.devMockService.applyScenario(parsed);
		});

		fastify.get("/api/comments/bootstrap", async (request, reply) => {
			const parsed = assertParsed(
				bootstrapQuerySchema.safeParse(request.query),
			);
			return setVisitorCookie(
				reply,
				await input.devMockService.getBootstrap({
					...parsed,
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});

		fastify.get("/api/comments/thread", async (request, reply) => {
			const parsed = assertParsed(threadQuerySchema.safeParse(request.query));
			return setVisitorCookie(
				reply,
				await input.devMockService.getThread({
					...parsed,
					pageTitle: undefined,
					pageUrl: undefined,
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});

		fastify.post("/api/comments", async (request, reply) => {
			const parsed = assertParsed(
				createCommentBodySchema.safeParse(request.body),
			);
			return setVisitorCookie(
				reply,
				await input.devMockService.createComment({
					siteKey: parsed.siteKey,
					pageKey: parsed.pageKey,
					pageTitle: parsed.pageTitle,
					pageUrl: parsed.pageUrl,
					parentCommentId: parsed.parentCommentId,
					author: parsed.author,
					contentRaw: parsed.content.raw,
					captcha: parsed.captcha,
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});

		fastify.post("/api/comments/:commentId/vote", async (request, reply) => {
			const params = assertParsed(
				voteCommentParamsSchema.safeParse(request.params),
			);
			const body = assertParsed(voteCommentBodySchema.safeParse(request.body));
			return setVisitorCookie(
				reply,
				await input.devMockService.castVote({
					siteKey: body.siteKey,
					pageKey: body.pageKey,
					commentId: params.commentId,
					choice: body.choice,
					captcha: body.captcha,
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});

		fastify.get("/api/comments/captcha/state", async (request, reply) => {
			const parsed = assertParsed(
				captchaStateQuerySchema.safeParse(request.query),
			);
			return setVisitorCookie(
				reply,
				await input.devMockService.getCaptchaState({
					...parsed,
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});

		fastify.post("/api/comments/captcha/refresh", async (request, reply) => {
			const parsed = assertParsed(
				captchaRefreshBodySchema.safeParse(request.body),
			);
			return setVisitorCookie(
				reply,
				await input.devMockService.refreshCaptcha({
					...parsed,
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});

		fastify.post("/api/comments/captcha/verify", async (request) => {
			const parsed = assertParsed(
				captchaVerifyBodySchema.safeParse(request.body),
			);
			const result = await input.devMockService.verifyCaptcha({
				siteKey: parsed.siteKey,
				pageKey: parsed.pageKey,
				challengeId: parsed.challengeId,
				value: parsed.value,
				visitorKey: request.context?.visitor?.key,
			});
			return result.body;
		});

		fastify.post("/api/page-feedback/like", async (request, reply) => {
			const parsed = assertParsed(pageLikeBodySchema.safeParse(request.body));
			return setVisitorCookie(
				reply,
				await input.devMockService.likePage({
					...parsed,
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});
	};
}
