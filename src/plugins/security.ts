import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { and, eq, gte, isNull, or } from "drizzle-orm";

import { sanitizeLogData } from "../logging/redaction";
import type { AppEventName, LogLevel } from "../logging/types";
import {
	matchBlacklistRule,
	type BlacklistSubject,
} from "../modules/shared/blacklist-match";
import {
	matchAllowlistRule,
	type AllowlistSubject,
} from "../modules/shared/allowlist-match";
import {
	hashCsrfToken,
	hashSessionToken,
} from "../modules/admin/session-utils";
import type {
	RateLimitRule,
	RateLimitSnapshot,
} from "../modules/shared/rate-limit";
import { MemoryRateLimitStore } from "../modules/shared/rate-limit";
import { AppError } from "../modules/shared/errors";
import {
	adminSessions,
	allowlistRules,
	auditLogs,
	blacklistRules,
} from "../db/schema";
import { joinPublicPath, stripPublicPath } from "../config/public-path";
import {
	createSystemSettingsDefaults,
	RuntimeSystemSettingsService,
} from "../modules/system-settings/service";
import type { SystemSettings } from "../modules/system-settings/definitions";

type SecuritySettings = SystemSettings["security"];

const PUBLIC_WRITE_ROUTES = [
	{ method: "POST", pattern: /^\/api\/comments$/ },
	{ method: "POST", pattern: /^\/api\/comments\/[^/]+\/vote$/ },
	{ method: "POST", pattern: /^\/api\/comments\/captcha\/refresh$/ },
	{ method: "POST", pattern: /^\/api\/comments\/captcha\/verify$/ },
	{ method: "POST", pattern: /^\/api\/comments\/captcha\/complete$/ },
	{ method: "POST", pattern: /^\/api\/page-feedback\/like$/ },
];

export interface BlacklistCheckInput {
	requestId?: string;
	siteKey?: string;
	pageKey?: string;
	visitorKey?: string;
	email?: string;
	ip?: string;
	requestScope?: "read" | "write";
	errorCode: string;
	errorMessage: string;
}

export interface RateLimitPeekInput {
	key: string;
	rule: RateLimitRule;
	now?: number;
}

export interface RateLimitInput extends RateLimitPeekInput {
	increment?: number;
	errorCode: string;
	errorMessage: string;
}

export interface AuditWriteInput {
	siteKey?: string;
	pageKey?: string;
	requestId?: string;
	actorType: string;
	actorId?: string;
	action?: string;
	event?: AppEventName;
	level?: LogLevel;
	message?: string;
	targetType?: string;
	targetId?: string;
	payload?: Record<string, unknown>;
}

export interface SecurityToolkit {
	assertGlobalFloodAllowed(input: { ip?: string }): Promise<void>;
	getRateLimitRule<K extends keyof SecuritySettings["rateLimit"]>(
		key: K,
	): Promise<SecuritySettings["rateLimit"][K]>;
	assertNotBlacklisted(input: BlacklistCheckInput): Promise<void>;
	recordAbuseWriteAction(input: {
		requestId?: string;
		siteKey: string;
		pageKey?: string;
		ip?: string;
		rule: RateLimitRule;
		scope: "post" | "all";
		ttlSec: number;
		now?: number;
	}): Promise<boolean>;
	consumeRateLimit(input: RateLimitInput): Promise<RateLimitSnapshot>;
	peekRateLimit(input: RateLimitPeekInput): RateLimitSnapshot;
	writeAudit(input: AuditWriteInput): Promise<void>;
	clearExpiredState(now?: number): void;
}

function resolvePathname(rawUrl: string): string {
	try {
		return new URL(rawUrl, "http://qingyan.local").pathname;
	} catch {
		return rawUrl.split("?")[0] ?? rawUrl;
	}
}

function isPublicWriteRequest(method: string, pathname: string): boolean {
	return PUBLIC_WRITE_ROUTES.some(
		(route) => route.method === method && route.pattern.test(pathname),
	);
}

function isAdminWriteRequest(method: string, pathname: string): boolean {
	if (!pathname.startsWith("/api/admin/")) {
		return false;
	}
	if (pathname === "/api/admin/session/login") {
		return false;
	}
	if (pathname === "/api/admin/session/captcha") {
		return false;
	}
	return ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}

function readOrigin(
	requestOrigin: string | string[] | undefined,
): string | undefined {
	return typeof requestOrigin === "string" && requestOrigin.length > 0
		? requestOrigin
		: undefined;
}

function setCorsHeaders(
	reply: {
		header(name: string, value: string): unknown;
	},
	origin: string,
	requestedHeaders?: string,
): void {
	reply.header("Access-Control-Allow-Origin", origin);
	reply.header("Vary", "Origin");
	reply.header("Access-Control-Allow-Credentials", "true");
	reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
	reply.header(
		"Access-Control-Allow-Headers",
		requestedHeaders || "content-type,x-request-id,x-qingyan-visitor",
	);
}

const securityPlugin: FastifyPluginAsync = async (fastify) => {
	const rateLimitStore = new MemoryRateLimitStore();
	const systemSettings = new RuntimeSystemSettingsService(
		fastify.db,
		createSystemSettingsDefaults({
			adminSession: {
				ttlMinutes: fastify.config.admin.session.ttlMinutes,
			},
			security: fastify.config.security,
		}),
	);
	const recordSecurityMetric = async (
		metricKey: "security.blacklist.hit" | "security.rate_limited",
		input: {
			siteKey?: string;
			scope?: string;
			targetType?: string;
			rule?: string;
		},
	) => {
		await fastify.taskMetricRollups
			.increment({
				siteId: input.siteKey
					? (fastify.siteRegistry.getRegisteredSite(input.siteKey)?.id ?? null)
					: null,
				siteKey: input.siteKey ?? null,
				metricKey,
				dimensions: {
					scope: input.scope ?? "unknown",
					targetType: input.targetType ?? "unknown",
					rule: input.rule ?? "unknown",
				},
			})
			.catch((error: unknown) => {
				fastify.log.warn({ err: error }, "Failed to write security metric");
			});
	};
	const matchesSecurityScope = (
		ruleScope: string,
		requestScope: "read" | "write",
	) =>
		ruleScope === "all" || (ruleScope === "post" && requestScope === "write");
	const isAllowlisted = async (input: {
		siteKey?: string;
		visitorKey?: string;
		email?: string;
		ip?: string;
		requestScope?: "read" | "write";
		nowIso?: string;
	}) => {
		const subject: AllowlistSubject = {
			visitorKey: input.visitorKey,
			email: input.email,
			ip: input.ip,
		};
		if (!subject.visitorKey && !subject.email && !subject.ip) {
			return false;
		}

		const siteId = fastify.siteRegistry.getRegisteredSite(input.siteKey)?.id;
		const nowIso = input.nowIso ?? new Date().toISOString();
		const activeRules = await fastify.db
			.select()
			.from(allowlistRules)
			.where(
				and(
					siteId === undefined
						? isNull(allowlistRules.siteId)
						: or(
								isNull(allowlistRules.siteId),
								eq(allowlistRules.siteId, siteId),
							),
					isNull(allowlistRules.deletedAt),
					or(
						isNull(allowlistRules.expiresAt),
						gte(allowlistRules.expiresAt, nowIso),
					),
				),
			);

		const requestScope = input.requestScope ?? "write";
		return activeRules.some(
			(rule) =>
				matchesSecurityScope(rule.scope, requestScope) &&
				matchAllowlistRule(
					{
						targetType: rule.targetType,
						targetValue: rule.targetValue,
						matchMode: rule.matchMode,
					},
					subject,
				),
		);
	};

	const security: SecurityToolkit = {
		async assertGlobalFloodAllowed({ ip }) {
			const guard = (await systemSettings.getSecuritySettings())
				.globalFloodGuard;
			if (!guard.enabled || !ip) {
				return;
			}

			try {
				rateLimitStore.consume(`global:${ip}`, {
					windowSec: guard.windowSec,
					maxRequests: guard.maxRequests,
				});
			} catch (error) {
				if (
					error instanceof Error &&
					error.message === "RATE_LIMIT_EXCEEDED" &&
					"resetAt" in error
				) {
					await recordSecurityMetric("security.rate_limited", {
						scope: "global",
						rule: "globalFloodGuard",
					});
					throw new AppError(
						429,
						"GLOBAL_RATE_LIMITED",
						"请求过于频繁，请稍后再试。",
						{
							resetAt: (error as Error & { resetAt: number }).resetAt,
						},
					);
				}

				throw error;
			}
		},
		async getRateLimitRule(key) {
			return (await systemSettings.getSecuritySettings()).rateLimit[key];
		},
		async assertNotBlacklisted(input) {
			const siteId = fastify.siteRegistry.getRegisteredSite(input.siteKey)?.id;
			const expiresAfter = new Date().toISOString();
			const subject: BlacklistSubject = {
				visitorKey: input.visitorKey,
				email: input.email,
				ip: input.ip,
			};
			if (!subject.visitorKey && !subject.email && !subject.ip) {
				return;
			}
			if (
				await isAllowlisted({
					siteKey: input.siteKey,
					visitorKey: input.visitorKey,
					email: input.email,
					ip: input.ip,
					requestScope: input.requestScope,
					nowIso: expiresAfter,
				})
			) {
				return;
			}

			const activeRules = await fastify.db
				.select()
				.from(blacklistRules)
				.where(
					and(
						siteId === undefined
							? isNull(blacklistRules.siteId)
							: or(
									isNull(blacklistRules.siteId),
									eq(blacklistRules.siteId, siteId),
								),
						or(
							isNull(blacklistRules.expiresAt),
							gte(blacklistRules.expiresAt, expiresAfter),
						),
					),
				);

			const requestScope = input.requestScope ?? "write";
			const matchedRule = activeRules.find((rule) => {
				const blocksRequest = matchesSecurityScope(rule.scope, requestScope);

				return (
					blocksRequest &&
					matchBlacklistRule(
						{
							targetType: rule.targetType,
							targetValue: rule.targetValue,
							matchMode: rule.matchMode,
						},
						subject,
					)
				);
			});

			if (matchedRule) {
				await recordSecurityMetric("security.blacklist.hit", {
					siteKey: input.siteKey,
					scope: matchedRule.scope,
					targetType: matchedRule.targetType,
					rule: matchedRule.source,
				});
				await fastify.loggerManager.logApp({
					level: "warn",
					channel: "app",
					event: "security.blacklist.hit",
					requestId: input.requestId,
					siteKey: input.siteKey,
					pageKey: input.pageKey,
					message: "请求命中黑名单",
					actorType: "system",
					targetType: matchedRule.targetType,
					targetId: matchedRule.targetValue,
					data: {
						scope: matchedRule.scope,
					},
				});
				throw new AppError(403, input.errorCode, input.errorMessage, {
					targetType: matchedRule.targetType,
					scope: matchedRule.scope,
				});
			}
		},
		async recordAbuseWriteAction(input) {
			if (!input.ip) {
				return false;
			}
			if (
				await isAllowlisted({
					siteKey: input.siteKey,
					ip: input.ip,
					requestScope: "write",
					nowIso: new Date(input.now ?? Date.now()).toISOString(),
				})
			) {
				return false;
			}

			try {
				rateLimitStore.consume(
					`abuse:${input.siteKey}:${input.ip}`,
					input.rule,
					input.now,
				);
				return false;
			} catch (error) {
				if (
					!(error instanceof Error) ||
					error.message !== "RATE_LIMIT_EXCEEDED"
				) {
					throw error;
				}

				const siteId = fastify.siteRegistry.getRegisteredSite(
					input.siteKey,
				)?.id;
				await recordSecurityMetric("security.rate_limited", {
					siteKey: input.siteKey,
					scope: input.scope,
					targetType: "ip",
					rule: "abuse_guard",
				});
				if (!siteId) {
					return false;
				}

				const now = input.now ?? Date.now();
				const expiresAt = new Date(now + input.ttlSec * 1000).toISOString();
				const currentIso = new Date(now).toISOString();
				const [existingRule] = await fastify.db
					.select()
					.from(blacklistRules)
					.where(
						and(
							eq(blacklistRules.siteId, siteId),
							eq(blacklistRules.scope, input.scope),
							eq(blacklistRules.targetType, "ip"),
							eq(blacklistRules.targetValue, input.ip),
							eq(blacklistRules.matchMode, "exact"),
							or(
								isNull(blacklistRules.expiresAt),
								gte(blacklistRules.expiresAt, currentIso),
							),
						),
					)
					.limit(1);

				if (existingRule) {
					return false;
				}

				await fastify.db.insert(blacklistRules).values({
					siteId,
					scope: input.scope,
					targetType: "ip",
					targetValue: input.ip,
					matchMode: "exact",
					source: "auto",
					reason: "abuse_guard",
					expiresAt,
				});
				await fastify.loggerManager.logApp({
					level: "warn",
					channel: "app",
					event: "security.blacklist.added",
					requestId: input.requestId,
					siteKey: input.siteKey,
					pageKey: input.pageKey,
					message: "已新增自动黑名单规则",
					actorType: "system",
					targetType: "ip",
					targetId: input.ip,
					data: {
						reason: "abuse_guard",
						scope: input.scope,
						expiresAt,
					},
				});

				return true;
			}
		},
		async consumeRateLimit({
			key,
			rule,
			increment,
			now,
			errorCode,
			errorMessage,
		}) {
			try {
				return rateLimitStore.consume(key, rule, now, increment);
			} catch (error) {
				if (
					error instanceof Error &&
					error.message === "RATE_LIMIT_EXCEEDED" &&
					"resetAt" in error
				) {
					await recordSecurityMetric("security.rate_limited", {
						scope: "rate_limit",
						rule: errorCode,
					});
					throw new AppError(429, errorCode, errorMessage, {
						resetAt: (error as Error & { resetAt: number }).resetAt,
					});
				}

				throw error;
			}
		},
		peekRateLimit({ key, rule, now }) {
			return rateLimitStore.peek(key, rule, now);
		},
		async writeAudit(input) {
			const siteId = fastify.siteRegistry.getRegisteredSite(input.siteKey)?.id;
			const action = input.event ?? input.action ?? "audit.logged";
			const payload = input.payload
				? sanitizeLogData(input.payload)
				: undefined;
			await fastify.db.insert(auditLogs).values({
				siteId,
				actorType: input.actorType,
				actorId: input.actorId,
				action,
				targetType: input.targetType,
				targetId: input.targetId,
				payloadJson: payload ? JSON.stringify(payload) : undefined,
			});
			if (input.event && input.message) {
				await fastify.loggerManager.logApp({
					level: input.level ?? "info",
					channel: "app",
					event: input.event,
					requestId: input.requestId,
					siteKey: input.siteKey,
					pageKey: input.pageKey,
					message: input.message,
					actorType: input.actorType,
					actorId: input.actorId,
					targetType: input.targetType,
					targetId: input.targetId,
					data: payload,
				});
			}
		},
		clearExpiredState(now) {
			rateLimitStore.clearExpired(now);
		},
	};

	fastify.decorate("security", security);
	fastify.options(
		joinPublicPath(fastify.config.server.publicPath, "/api/*"),
		async (request, reply) => {
			const origin = readOrigin(request.headers.origin);
			if (!origin) {
				return reply.status(204).send();
			}

			const originAllowed = fastify.siteRegistry
				.listRegisteredSites()
				.some((site) => site.allowedOrigins.includes(origin));
			if (originAllowed) {
				const requestedHeaders =
					request.headers["access-control-request-headers"];
				setCorsHeaders(
					reply,
					origin,
					typeof requestedHeaders === "string" ? requestedHeaders : undefined,
				);
			}

			return reply.status(204).send();
		},
	);

	fastify.addHook("preHandler", async (request, reply) => {
		const url = request.raw.url ?? "";
		const pathname = resolvePathname(url);
		const internalPathname = stripPublicPath(
			fastify.config.server.publicPath,
			pathname,
		);
		if (!internalPathname?.startsWith("/api")) {
			return;
		}

		await security.assertGlobalFloodAllowed({
			ip: request.context?.ip ?? request.ip,
		});

		const origin = readOrigin(request.headers.origin);
		const site = fastify.siteRegistry.getRegisteredSite(
			request.context?.siteKey,
		);
		if (origin && site?.allowedOrigins.includes(origin)) {
			setCorsHeaders(reply, origin);
		}

		const runtimeSecurity = await systemSettings.getSecuritySettings();
		if (
			runtimeSecurity.publicOriginGuard.enabled &&
			isPublicWriteRequest(request.method, internalPathname)
		) {
			if (!origin) {
				if (
					runtimeSecurity.publicOriginGuard.allowMissingOrigin ||
					fastify.runtimeOptions.devMode.enabled
				) {
					return;
				}

				throw new AppError(
					403,
					"PUBLIC_ORIGIN_REQUIRED",
					"公开写接口需要浏览器来源信息。",
				);
			}

			if (!site?.allowedOrigins.includes(origin)) {
				throw new AppError(
					403,
					"PUBLIC_ORIGIN_FORBIDDEN",
					"请求来源不在站点允许列表中。",
				);
			}
		}

		if (
			!runtimeSecurity.adminOriginGuard.enabled ||
			!isAdminWriteRequest(request.method, internalPathname)
		) {
			return;
		}

		const sessionCookie =
			request.cookies[fastify.config.admin.session.cookieName];
		if (!sessionCookie) {
			throw new AppError(401, "ADMIN_AUTH_REQUIRED", "需要管理员登录。");
		}

		const allowedAdminOrigins =
			runtimeSecurity.adminOriginGuard.allowedOrigins.length > 0
				? [...runtimeSecurity.adminOriginGuard.allowedOrigins]
				: [new URL(fastify.config.server.publicBaseUrl).origin];
		const devAdminOrigin = fastify.runtimeOptions.devMode.adminOrigin;
		if (
			fastify.runtimeOptions.devMode.enabled &&
			devAdminOrigin &&
			!allowedAdminOrigins.includes(devAdminOrigin)
		) {
			allowedAdminOrigins.push(devAdminOrigin);
		}
		if (origin && !allowedAdminOrigins.includes(origin)) {
			throw new AppError(403, "ADMIN_ORIGIN_FORBIDDEN", "后台请求来源不合法。");
		}
		if (!origin && !runtimeSecurity.adminOriginGuard.allowMissingOrigin) {
			throw new AppError(403, "ADMIN_ORIGIN_FORBIDDEN", "后台请求来源不合法。");
		}

		const csrfToken = request.headers["x-qingyan-csrf-token"];
		if (typeof csrfToken !== "string" || csrfToken.length === 0) {
			throw new AppError(
				403,
				"ADMIN_CSRF_REQUIRED",
				"后台写请求缺少 CSRF token。",
			);
		}

		const [session] = await fastify.db
			.select()
			.from(adminSessions)
			.where(eq(adminSessions.tokenHash, hashSessionToken(sessionCookie)))
			.limit(1);
		if (
			!session?.csrfTokenHash ||
			session.csrfTokenHash !== hashCsrfToken(csrfToken)
		) {
			throw new AppError(
				403,
				"ADMIN_CSRF_INVALID",
				"后台写请求 CSRF token 无效。",
			);
		}
	});
};

export default fp(securityPlugin, {
	name: "qingyan-security",
});
