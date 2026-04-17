import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { and, eq, gte, isNull, or } from "drizzle-orm";

import {
	matchBlacklistRule,
	type BlacklistSubject,
} from "../modules/shared/blacklist-match";
import type {
	RateLimitRule,
	RateLimitSnapshot,
} from "../modules/shared/rate-limit";
import { MemoryRateLimitStore } from "../modules/shared/rate-limit";
import { AppError } from "../modules/shared/errors";
import { auditLogs, blacklistRules } from "../db/schema";

export interface BlacklistCheckInput {
	siteKey?: string;
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
	actorType: string;
	actorId?: string;
	action: string;
	targetType?: string;
	targetId?: string;
	payload?: Record<string, unknown>;
}

export interface SecurityToolkit {
	assertGlobalFloodAllowed(input: { ip?: string }): Promise<void>;
	assertNotBlacklisted(input: BlacklistCheckInput): Promise<void>;
	recordAbuseWriteAction(input: {
		siteKey: string;
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

const securityPlugin: FastifyPluginAsync = async (fastify) => {
	const rateLimitStore = new MemoryRateLimitStore();

	const security: SecurityToolkit = {
		async assertGlobalFloodAllowed({ ip }) {
			const guard = fastify.config.security.globalFloodGuard;
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
				const blocksRequest =
					rule.scope === "all" ||
					(rule.scope === "post" && requestScope === "write");

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
			await fastify.db.insert(auditLogs).values({
				siteId,
				actorType: input.actorType,
				actorId: input.actorId,
				action: input.action,
				targetType: input.targetType,
				targetId: input.targetId,
				payloadJson: input.payload ? JSON.stringify(input.payload) : undefined,
			});
		},
		clearExpiredState(now) {
			rateLimitStore.clearExpired(now);
		},
	};

	fastify.decorate("security", security);
	fastify.addHook("onRequest", async (request) => {
		const url = request.raw.url ?? "";
		if (!url.startsWith("/api")) {
			return;
		}

		await security.assertGlobalFloodAllowed({
			ip: request.context?.ip ?? request.ip,
		});
	});
};

export default fp(securityPlugin, {
	name: "qingyan-security",
});
