import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../../db/client";
import { blacklistRules, securityPenalties } from "../../db/schema";
import { AppError } from "../shared/errors";
import { releaseWafSyncIntent, saveWafSyncIntent } from "../waf/intent";
import type { AbusePolicy } from "./abuse-policy";

export async function lockAbuseSubject(
	db: DatabaseExecutor,
	siteId: number,
	ip: string,
) {
	await db.execute(
		sql`SELECT pg_advisory_xact_lock(hashtextextended(${`abuse:${siteId}:${ip}`}, 0))`,
	);
}

export class AbuseRepository {
	public constructor(private readonly db: DatabaseExecutor) {}
	public async pruneExpired(
		siteId: number,
		policy: AbusePolicy,
		now = Date.now(),
	) {
		const cutoff = new Date(
			now -
				Math.max(policy.evidenceRetentionDays * 86400, policy.repeatWindowSec) *
					1000,
		).toISOString();
		return this.db.transaction(async (tx) => {
			const expired = await tx
				.select()
				.from(securityPenalties)
				.where(
					and(
						eq(securityPenalties.siteId, siteId),
						lt(
							sql`coalesce(${securityPenalties.releasedAt}, ${securityPenalties.expiresAt})`,
							cutoff,
						),
						sql`NOT EXISTS (SELECT 1 FROM waf_sync_records w WHERE w.penalty_id = ${securityPenalties.id})`,
					),
				)
				.orderBy(securityPenalties.startedAt)
				.limit(100)
				.for("update", { skipLocked: true });
			if (!expired.length) return 0;
			await tx.delete(securityPenalties).where(
				inArray(
					securityPenalties.id,
					expired.map((penalty) => penalty.id),
				),
			);
			const ruleIds = expired.flatMap((penalty) =>
				penalty.sourceRuleId ? [penalty.sourceRuleId] : [],
			);
			if (ruleIds.length)
				await tx
					.delete(blacklistRules)
					.where(
						and(
							inArray(blacklistRules.id, ruleIds),
							eq(blacklistRules.source, "auto"),
							lt(blacklistRules.expiresAt, new Date(now).toISOString()),
							sql`NOT EXISTS (SELECT 1 FROM security_penalties p WHERE p.source_rule_id = ${blacklistRules.id})`,
						),
					);
			return expired.length;
		});
	}
	public async listByRuleIds(ruleIds: number[]) {
		if (!ruleIds.length) return [];
		return this.db
			.select()
			.from(securityPenalties)
			.where(inArray(securityPenalties.sourceRuleId, ruleIds));
	}

	public async assertAllowed(siteId: number, ip?: string) {
		if (!ip) return;
		await lockAbuseSubject(this.db, siteId, ip);
		const [active] = await this.db
			.select()
			.from(securityPenalties)
			.where(
				and(
					eq(securityPenalties.siteId, siteId),
					eq(securityPenalties.ip, ip),
					isNull(securityPenalties.releasedAt),
					gt(securityPenalties.expiresAt, new Date().toISOString()),
				),
			)
			.limit(1);
		if (active)
			throw new AppError(
				403,
				"COMMENT_BLACKLISTED",
				"当前请求已被限制，请在限制结束后重试。",
				{
					expiresAt: active.expiresAt,
					retryAfterSec: Math.max(
						1,
						Math.ceil((Date.parse(active.expiresAt) - Date.now()) / 1000),
					),
				},
			);
	}

	public async createPenalty(input: {
		siteId: number;
		ip: string;
		scope: "post" | "all";
		reason: string;
		policy: AbusePolicy;
		count: number;
		now?: number;
		violationObservedAt?: number;
	}) {
		return this.db.transaction(async (tx) => {
			await lockAbuseSubject(tx, input.siteId, input.ip);
			const now = input.now ?? Date.now();
			const nowIso = new Date(now).toISOString();
			if (input.violationObservedAt !== undefined) {
				const [releasedAfterObservation] = await tx
					.select()
					.from(securityPenalties)
					.where(
						and(
							eq(securityPenalties.siteId, input.siteId),
							eq(securityPenalties.ip, input.ip),
							gte(
								securityPenalties.releasedAt,
								new Date(input.violationObservedAt).toISOString(),
							),
						),
					)
					.orderBy(desc(securityPenalties.releasedAt))
					.limit(1);
				if (releasedAfterObservation) return releasedAfterObservation;
			}
			const [active] = await tx
				.select()
				.from(securityPenalties)
				.where(
					and(
						eq(securityPenalties.siteId, input.siteId),
						eq(securityPenalties.ip, input.ip),
						isNull(securityPenalties.releasedAt),
						gt(securityPenalties.expiresAt, nowIso),
					),
				)
				.limit(1);
			if (active) {
				if (input.reason !== "waf_scan" || active.reason === "waf_scan")
					return active;
				const expiresAt = new Date(
					Math.max(
						Date.parse(active.expiresAt),
						now + input.policy.penaltyTtlSec * 1000,
					),
				).toISOString();
				const [upgraded] = await tx
					.update(securityPenalties)
					.set({
						reason: "waf_scan",
						scope: "all",
						expiresAt,
						stateVersion: sql`${securityPenalties.stateVersion} + 1`,
						evidenceJson: JSON.stringify({
							...JSON.parse(active.evidenceJson),
							scanObservedAt: nowIso,
						}),
					})
					.where(eq(securityPenalties.id, active.id))
					.returning();
				if (active.sourceRuleId)
					await tx
						.update(blacklistRules)
						.set({ reason: "waf_scan", scope: "all", expiresAt })
						.where(eq(blacklistRules.id, active.sourceRuleId));
				return upgraded;
			}
			const [previous] = await tx
				.select()
				.from(securityPenalties)
				.where(
					and(
						eq(securityPenalties.siteId, input.siteId),
						eq(securityPenalties.ip, input.ip),
						gte(
							securityPenalties.startedAt,
							new Date(now - input.policy.repeatWindowSec * 1000).toISOString(),
						),
						sql`(${securityPenalties.releaseKind} IS NULL OR ${securityPenalties.releaseKind} <> 'revoked')`,
					),
				)
				.orderBy(desc(securityPenalties.startedAt))
				.limit(1);
			const expiresAt = new Date(
				now +
					(previous
						? input.policy.repeatPenaltyTtlSec
						: input.policy.penaltyTtlSec) *
						1000,
			).toISOString();
			const [rule] = await tx
				.insert(blacklistRules)
				.values({
					siteId: input.siteId,
					targetType: "ip",
					targetValue: input.ip,
					matchMode: "exact",
					scope: input.scope,
					source: "auto",
					reason: input.reason,
					expiresAt,
				})
				.returning();
			const [penalty] = await tx
				.insert(securityPenalties)
				.values({
					id: `pen_${randomUUID().replaceAll("-", "")}`,
					siteId: input.siteId,
					ip: input.ip,
					scope: input.scope,
					reason: input.reason,
					policyVersion: "abuse-v1",
					startedAt: nowIso,
					expiresAt,
					evidenceJson: JSON.stringify({
						count: Math.min(input.count, 10000),
						windowSec: input.policy.violationWindowSec,
						repeat: Boolean(previous),
					}),
					sourceRuleId: rule.id,
				})
				.returning();
			await saveWafSyncIntent(
				tx,
				penalty,
				input.policy.syncToWaf && input.reason === "rate_limited",
			);
			return penalty;
		});
	}

	public async release(input: {
		ruleId: number;
		kind: "revoked" | "released";
		reason: string;
		actorUserId?: number;
	}) {
		return this.db.transaction(async (tx) => {
			const [penalty] = await tx
				.select()
				.from(securityPenalties)
				.where(eq(securityPenalties.sourceRuleId, input.ruleId))
				.limit(1);
			if (!penalty) return null;
			await lockAbuseSubject(tx, penalty.siteId, penalty.ip);
			const [released] = await tx
				.update(securityPenalties)
				.set({
					releasedAt: new Date().toISOString(),
					releaseKind: input.kind,
					releaseReason: input.reason,
					releasedByUserId: input.actorUserId,
					stateVersion: sql`${securityPenalties.stateVersion} + 1`,
				})
				.where(
					and(
						eq(securityPenalties.id, penalty.id),
						isNull(securityPenalties.releasedAt),
					),
				)
				.returning();
			await tx
				.update(blacklistRules)
				.set({ expiresAt: new Date().toISOString() })
				.where(eq(blacklistRules.id, input.ruleId));
			if (released) await releaseWafSyncIntent(tx, released);
			return released ?? penalty;
		});
	}
}
