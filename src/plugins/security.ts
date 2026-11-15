import { and, eq, gte, isNull, or } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { joinPublicPath, stripPublicPath } from "../config/public-path";
import type { DatabaseExecutor } from "../db/client";
import {
	adminSessions,
	allowlistRules,
	auditLogs,
	blacklistRules,
	siteSettings,
} from "../db/schema";
import { sanitizeLogData } from "../logging/redaction";
import type { AppEventName, LogLevel } from "../logging/types";
import {
	hashCsrfToken,
	hashSessionToken,
} from "../modules/admin/session-utils";
import { readAbusePolicy } from "../modules/comments/abuse-policy";
import { SecuritySubjectService } from "../modules/comments/security-subject";
import {
	type WriteAdmissionInput,
	WriteAdmissionService,
} from "../modules/comments/write-admission";
import {
	type AllowlistSubject,
	matchAllowlistRule,
} from "../modules/shared/allowlist-match";
import {
	type BlacklistSubject,
	matchBlacklistRule,
} from "../modules/shared/blacklist-match";
import { AppError } from "../modules/shared/errors";
import type {
	RateLimitRule,
	RateLimitSnapshot,
} from "../modules/shared/rate-limit";
import { MemoryRateLimitStore } from "../modules/shared/rate-limit";
import type { WriteQuotaLease } from "../modules/shared/write-quota";
import type { SystemSettings } from "../modules/system-settings/definitions";
import {
	createSystemSettingsDefaults,
	RuntimeSystemSettingsService,
} from "../modules/system-settings/service";

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
	reserveWriteQuota(input: WriteAdmissionInput): WriteQuotaLease;
	recordWriteViolation(input: {
		siteId: number;
		siteKey: string;
		ip?: string;
		reason: string;
		visitorKey?: string;
		email?: string;
		now?: number;
	}): Promise<void>;
	assertWriteCommitAllowed(
		tx: DatabaseExecutor,
		input: {
			siteId: number;
			siteKey: string;
			ip?: string;
			visitorKey?: string;
			email?: string;
		},
	): Promise<void>;
	resetWriteState(siteKey: string, ip: string): void;
	assertGlobalFloodAllowed(input: { ip?: string }): Promise<void>;
	getRateLimitRule<K extends keyof SecuritySettings["rateLimit"]>(
		key: K,
	): Promise<SecuritySettings["rateLimit"][K]>;
	assertNotBlacklisted(
		input: BlacklistCheckInput,
		database?: DatabaseExecutor,
	): Promise<void>;
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
	reply.header(
		"Access-Control-Expose-Headers",
		"X-QingYan-Security, Retry-After",
	);
	reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
	reply.header(
		"Access-Control-Allow-Headers",
		requestedHeaders ||
			"content-type,x-request-id,x-qingyan-visitor,x-qingyan-security",
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
	const isAllowlisted = async (
		input: {
			siteKey?: string;
			visitorKey?: string;
			email?: string;
			ip?: string;
			requestScope?: "read" | "write";
			nowIso?: string;
		},
		database: DatabaseExecutor = fastify.db,
	) => {
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
		const activeRules = await database
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

	const writeAdmission = new WriteAdmissionService(
		fastify.db,
		(siteKey, ip, tx, subject) =>
			isAllowlisted(
				{
					siteKey,
					ip,
					...subject,
					requestScope: "write",
					nowIso: new Date().toISOString(),
				},
				tx,
			),
	);
	const security: SecurityToolkit = {
		reserveWriteQuota: (input) => writeAdmission.reserve(input),
		recordWriteViolation: (input) => writeAdmission.recordViolation(input),
		assertWriteCommitAllowed: (tx, input) =>
			writeAdmission.assertCommitAllowed(tx, input),
		resetWriteState: (siteKey, ip) => {
			const subjects = writeAdmission.reset(siteKey, ip);
			const siteId = fastify.siteRegistry.getRegisteredSite(siteKey)?.id;
			rateLimitStore.resetPrefix(`captcha-cost-ip:${siteKey}:${ip}`);
			for (const subject of subjects) {
				rateLimitStore.resetPrefix(`captcha-cost:${siteKey}:${subject}`);
				rateLimitStore.resetPrefix(
					`public:${siteKey}:${subject}:captcha_verify`,
				);
				if (siteId)
					rateLimitStore.resetPrefix(`captcha-threshold:${siteId}:${subject}:`);
			}
		},
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
		async assertNotBlacklisted(input, database = fastify.db) {
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
				await isAllowlisted(
					{
						siteKey: input.siteKey,
						visitorKey: input.visitorKey,
						email: input.email,
						ip: input.ip,
						requestScope: input.requestScope,
						nowIso: expiresAfter,
					},
					database,
				)
			) {
				return;
			}

			const activeRules = await database
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
				if (database === fastify.db)
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
					...(matchedRule.expiresAt
						? {
								expiresAt: matchedRule.expiresAt,
								retryAfterSec: Math.max(
									1,
									Math.ceil(
										(Date.parse(matchedRule.expiresAt) - Date.now()) / 1000,
									),
								),
							}
						: {}),
				});
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
	for (const site of fastify.siteRegistry.listRegisteredSites())
		await writeAdmission.prune(site.id);
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
					!runtimeSecurity.publicOriginGuard.allowMissingOrigin &&
					!fastify.runtimeOptions.devMode.enabled
				) {
					throw new AppError(
						403,
						"PUBLIC_ORIGIN_REQUIRED",
						"公开写接口需要浏览器来源信息。",
					);
				}
			}

			if (origin && !site?.allowedOrigins.includes(origin)) {
				throw new AppError(
					403,
					"PUBLIC_ORIGIN_FORBIDDEN",
					"请求来源不在站点允许列表中。",
				);
			}
		}
		if (
			site &&
			request.context &&
			!fastify.devMockService?.ownsSite(site.siteKey) &&
			(isPublicWriteRequest(request.method, internalPathname) ||
				internalPathname.startsWith("/api/comments/captcha/") ||
				internalPathname === "/api/comments/bootstrap")
		) {
			if (
				isPublicWriteRequest(request.method, internalPathname) &&
				internalPathname !== "/api/comments"
			)
				await security.assertNotBlacklisted({
					siteKey: site.siteKey,
					ip: request.context.ip,
					visitorKey: request.context.visitor?.key,
					requestScope: "write",
					errorCode: "COMMENT_BLACKLISTED",
					errorMessage: "当前请求已被拒绝。",
				});
			const body =
				request.body && typeof request.body === "object"
					? (request.body as Record<string, unknown>)
					: {};
			const query =
				request.query && typeof request.query === "object"
					? (request.query as Record<string, unknown>)
					: {};
			const header = request.headers["x-qingyan-security"];
			const token =
				typeof body.securityToken === "string"
					? body.securityToken
					: typeof query.securityToken === "string"
						? query.securityToken
						: typeof header === "string"
							? header
							: request.cookies[`qingyan_security_${site.id}`];
			const subject = await new SecuritySubjectService(fastify.db).resolve(
				site.id,
				token,
			);
			request.context.securityToken = subject.token;
			request.context.securitySubjectId = subject.id;
			if (request.context.ip)
				writeAdmission.remember(site.siteKey, request.context.ip, subject.id);
			reply.setCookie(`qingyan_security_${site.id}`, subject.token, {
				path: joinPublicPath(fastify.config.server.publicPath, "/"),
				sameSite: "lax",
				httpOnly: true,
				secure: request.protocol === "https",
				maxAge: 86400,
			});
			reply.header("X-QingYan-Security", subject.token);
			if (internalPathname.startsWith("/api/comments/captcha/")) {
				const [settings] = await fastify.db
					.select()
					.from(siteSettings)
					.where(eq(siteSettings.siteId, site.id))
					.limit(1);
				const policy = readAbusePolicy(settings?.abusePolicyJson);
				try {
					await security.consumeRateLimit({
						key: `captcha-cost:${site.siteKey}:${subject.id}`,
						rule: {
							windowSec: policy.captchaWindowSec,
							maxRequests: policy.captchaRequestMax,
						},
						errorCode: "COMMENT_RATE_LIMITED",
						errorMessage: "验证码操作过于频繁，请稍后再试。",
					});
					await security.consumeRateLimit({
						key: `captcha-cost-ip:${site.siteKey}:${request.context.ip}`,
						rule: {
							windowSec: policy.captchaWindowSec,
							maxRequests: policy.captchaIpMax,
						},
						errorCode: "COMMENT_RATE_LIMITED",
						errorMessage: "验证码操作过于频繁，请稍后再试。",
					});
				} catch (error) {
					if (error instanceof AppError && error.statusCode === 429)
						await security.recordWriteViolation({
							siteId: site.id,
							siteKey: site.siteKey,
							ip: request.context.ip,
							visitorKey: request.context.visitor?.key,
							reason: "rate_limited",
						});
					throw error;
				}
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
