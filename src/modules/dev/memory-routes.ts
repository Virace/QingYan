import type { FastifyPluginAsync } from "fastify";

import { qingyanCookiePath } from "../../config/public-path";
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

function requireLegacyPageKey(pageKey?: string): string {
	if (!pageKey) {
		throw new Error("Dev memory routes require pageKey.");
	}

	return pageKey;
}

function requireLegacyPageUrl(pageUrl?: string): string {
	if (!pageUrl) {
		throw new Error("Dev memory routes require pageUrl.");
	}

	return pageUrl;
}

export function createDevMemoryRoutes(input: {
	devMockService: DevMockService;
	runtimeOptions: AppRuntimeOptions;
}): FastifyPluginAsync {
	const sessions = new DevMemorySessionStore(input.runtimeOptions);

	return async (fastify) => {
		const seedSite = input.runtimeOptions.devMode.seed?.site;
		if (!seedSite) {
			throw new Error("Dev memory mode requires a seed site.");
		}

		fastify.post("/dev/session", async (request, reply) => {
			const parsed = assertParsed(devSessionBodySchema.safeParse(request.body));
			const session = sessions.create(parsed.token);
			reply.setCookie(sessions.getCookieName(), session.sessionToken, {
				path: qingyanCookiePath(fastify.config.server.publicPath),
				sameSite: fastify.config.admin.session.sameSite,
				httpOnly: true,
				secure: fastify.config.admin.session.secure,
			});

			return {
				authenticated: true,
				session: { expiresAt: session.expiresAt },
			};
		});

		fastify.get("/admin/session/me", async (request) => {
			const session = sessions.require(request);
			return {
				authenticated: true,
				session: { expiresAt: session.expiresAt },
				user: {
					id: 0,
					username: input.runtimeOptions.devMode.adminUsername ?? "admin",
					email: "admin@localhost.invalid",
					displayName: input.runtimeOptions.devMode.adminUsername ?? "admin",
					groupKey: "admin",
					groupName: "管理员",
					isInitialAdmin: true,
					passwordChangeRequired: false,
				},
				permissions: ["*"],
				sites: [
					{
						siteKey: seedSite.siteKey,
						name: seedSite.name,
						allowedOrigins: seedSite.allowedOrigins,
					},
				],
			};
		});

		fastify.post("/admin/session/logout", async (request, reply) => {
			sessions.delete(request);
			reply.clearCookie(sessions.getCookieName(), {
				path: qingyanCookiePath(fastify.config.server.publicPath),
			});
			return { authenticated: false };
		});

		fastify.get("/admin/sites", async (request) => {
			sessions.require(request);
			return { items: [buildSiteSummary(seedSite)] };
		});

		fastify.get("/dev/state", async (request) => {
			sessions.require(request);
			const parsed = assertParsed(devStateQuerySchema.safeParse(request.query));
			return input.devMockService.inspect(
				parsed.siteKey,
				parsed.pageKey,
				parsed.visitorKey,
			);
		});

		fastify.post("/dev/reset", async (request) => {
			sessions.require(request);
			const parsed = assertParsed(devResetBodySchema.safeParse(request.body));
			return input.devMockService.resetPageState(
				parsed.siteKey,
				parsed.pageKey,
			);
		});

		fastify.post("/dev/scenario", async (request) => {
			sessions.require(request);
			const parsed = assertParsed(
				devScenarioBodySchema.safeParse(request.body),
			);
			return input.devMockService.applyScenario(parsed);
		});

		fastify.get("/comments/bootstrap", async (request, reply) => {
			const parsed = assertParsed(
				bootstrapQuerySchema.safeParse(request.query),
			);
			return setVisitorCookie(
				reply,
				await input.devMockService.getBootstrap({
					...parsed,
					pageKey: requireLegacyPageKey(parsed.pageKey),
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});

		fastify.get("/comments/thread", async (request, reply) => {
			const parsed = assertParsed(threadQuerySchema.safeParse(request.query));
			return setVisitorCookie(
				reply,
				await input.devMockService.getThread({
					...parsed,
					pageKey: requireLegacyPageKey(parsed.pageKey),
					pageTitle: undefined,
					pageUrl: undefined,
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});

		fastify.post("/comments", async (request, reply) => {
			const parsed = assertParsed(
				createCommentBodySchema.safeParse(request.body),
			);
			return setVisitorCookie(
				reply,
				await input.devMockService.createComment({
					siteKey: parsed.siteKey,
					pageKey: requireLegacyPageKey(parsed.pageKey),
					pageTitle: parsed.pageTitle,
					pageUrl: requireLegacyPageUrl(parsed.pageUrl),
					parentCommentId: parsed.parentCommentId,
					author: parsed.author,
					contentRaw: parsed.content.raw,
					captcha: parsed.captcha,
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});

		fastify.post("/comments/:commentId/vote", async (request, reply) => {
			const params = assertParsed(
				voteCommentParamsSchema.safeParse(request.params),
			);
			const body = assertParsed(voteCommentBodySchema.safeParse(request.body));
			return setVisitorCookie(
				reply,
				await input.devMockService.castVote({
					siteKey: body.siteKey,
					pageKey: requireLegacyPageKey(body.pageKey),
					commentId: params.commentId,
					choice: body.choice,
					captcha: body.captcha,
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});

		fastify.get("/comments/captcha/state", async (request, reply) => {
			const parsed = assertParsed(
				captchaStateQuerySchema.safeParse(request.query),
			);
			return setVisitorCookie(
				reply,
				await input.devMockService.getCaptchaState({
					...parsed,
					pageKey: requireLegacyPageKey(parsed.pageKey),
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});

		fastify.post("/comments/captcha/refresh", async (request, reply) => {
			const parsed = assertParsed(
				captchaRefreshBodySchema.safeParse(request.body),
			);
			return setVisitorCookie(
				reply,
				await input.devMockService.refreshCaptcha({
					...parsed,
					pageKey: requireLegacyPageKey(parsed.pageKey),
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});

		fastify.post("/comments/captcha/verify", async (request) => {
			const parsed = assertParsed(
				captchaVerifyBodySchema.safeParse(request.body),
			);
			const result = await input.devMockService.verifyCaptcha({
				siteKey: parsed.siteKey,
				pageKey: requireLegacyPageKey(parsed.pageKey),
				challengeId: parsed.challengeId,
				value: parsed.value,
				visitorKey: request.context?.visitor?.key,
			});
			return result.body;
		});

		fastify.post("/page-feedback/like", async (request, reply) => {
			const parsed = assertParsed(pageLikeBodySchema.safeParse(request.body));
			return setVisitorCookie(
				reply,
				await input.devMockService.likePage({
					...parsed,
					pageKey: requireLegacyPageKey(parsed.pageKey),
					pageUrl: requireLegacyPageUrl(parsed.pageUrl),
					visitorKey: request.context?.visitor?.key,
				}),
			);
		});
	};
}
