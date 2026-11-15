import { randomUUID } from "node:crypto";
import {
	and,
	count,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNull,
	lt,
	or,
	sql,
} from "drizzle-orm";
import type { DatabaseExecutor } from "../../db/client";
import {
	allowlistRules,
	commentRequestMetadata,
	comments,
	securityPenalties,
	sites,
	wafSyncRecords,
} from "../../db/schema";
import type { AbusePolicy } from "../comments/abuse-policy";
import { matchAllowlistRule } from "../shared/allowlist-match";
import { AppError } from "../shared/errors";
import { TaskRunRepository } from "../tasks/task-run-repository";

export type WafSyncRecord = typeof wafSyncRecords.$inferSelect;

export class WafSyncRepository {
	public constructor(public readonly db: DatabaseExecutor) {}
	public async get(id: string) {
		const [row] = await this.db
			.select()
			.from(wafSyncRecords)
			.where(eq(wafSyncRecords.id, id))
			.limit(1);
		return row ?? null;
	}
	public async penalty(id: string) {
		const [row] = await this.db
			.select()
			.from(securityPenalties)
			.where(eq(securityPenalties.id, id))
			.limit(1);
		return row ?? null;
	}
	public async isIpAllowlisted(siteId: number, ip: string, now: Date) {
		const rules = await this.db
			.select()
			.from(allowlistRules)
			.where(
				and(
					or(isNull(allowlistRules.siteId), eq(allowlistRules.siteId, siteId)),
					eq(allowlistRules.targetType, "ip"),
					inArray(allowlistRules.scope, ["post", "all"]),
					isNull(allowlistRules.deletedAt),
					or(
						isNull(allowlistRules.expiresAt),
						gte(allowlistRules.expiresAt, now.toISOString()),
					),
				),
			);
		return rules.some((rule) => matchAllowlistRule(rule, { ip }));
	}
	public async hasSharedIp(siteId: number, ip: string) {
		const rows = await this.db
			.selectDistinct({
				visitorId: comments.visitorId,
				authorUserId: comments.authorUserId,
				emailHash: comments.authorEmailHash,
			})
			.from(comments)
			.innerJoin(
				commentRequestMetadata,
				eq(commentRequestMetadata.commentId, comments.id),
			)
			.where(
				and(
					eq(comments.siteId, siteId),
					eq(commentRequestMetadata.authorIp, ip),
					gt(comments.createdAt, new Date(Date.now() - 86400000).toISOString()),
					isNull(comments.deletedAt),
				),
			)
			.limit(2);
		return rows.length > 1;
	}
	public async listForSync(siteId: number, recordId?: string) {
		return this.db
			.select()
			.from(wafSyncRecords)
			.where(
				and(
					eq(wafSyncRecords.siteId, siteId),
					recordId ? eq(wafSyncRecords.id, recordId) : undefined,
				),
			)
			.orderBy(wafSyncRecords.updatedAt)
			.limit(1000);
	}
	public async claim(id: string, revision: number, now: Date) {
		const [row] = await this.db
			.update(wafSyncRecords)
			.set({
				claimToken: randomUUID(),
				claimExpiresAt: new Date(now.getTime() + 120000).toISOString(),
				lastAttemptAt: now.toISOString(),
			})
			.where(
				and(
					eq(wafSyncRecords.id, id),
					eq(wafSyncRecords.revision, revision),
					isNull(wafSyncRecords.suspendedAt),
					or(
						isNull(wafSyncRecords.claimToken),
						lt(wafSyncRecords.claimExpiresAt, now.toISOString()),
					),
				),
			)
			.returning();
		return row ?? null;
	}
	public async finish(
		row: WafSyncRecord,
		values: Partial<typeof wafSyncRecords.$inferInsert>,
	) {
		const updated = await this.db
			.update(wafSyncRecords)
			.set({
				...values,
				claimToken: null,
				claimExpiresAt: null,
				updatedAt: new Date().toISOString(),
			})
			.where(
				and(
					eq(wafSyncRecords.id, row.id),
					eq(wafSyncRecords.revision, row.revision),
					eq(wafSyncRecords.claimToken, row.claimToken ?? ""),
				),
			)
			.returning({ id: wafSyncRecords.id });
		return updated.length === 1;
	}
	public async bind(
		row: WafSyncRecord,
		websiteId: number,
		websiteKey: string,
		expectedFingerprint: string,
	) {
		const updated = await this.db
			.update(wafSyncRecords)
			.set({ websiteId, websiteKey, expectedFingerprint })
			.where(
				and(
					eq(wafSyncRecords.id, row.id),
					eq(wafSyncRecords.revision, row.revision),
					eq(wafSyncRecords.claimToken, row.claimToken ?? ""),
				),
			)
			.returning({ id: wafSyncRecords.id });
		return updated.length === 1;
	}
	public async list(siteId: number, limit: number, offset: number) {
		const where = eq(wafSyncRecords.siteId, siteId);
		const [rows, totals] = await Promise.all([
			this.db
				.select({ sync: wafSyncRecords, penalty: securityPenalties })
				.from(wafSyncRecords)
				.innerJoin(
					securityPenalties,
					eq(securityPenalties.id, wafSyncRecords.penaltyId),
				)
				.where(where)
				.orderBy(desc(wafSyncRecords.updatedAt))
				.limit(limit)
				.offset(offset),
			this.db.select({ total: count() }).from(wafSyncRecords).where(where),
		]);
		const now = new Date().toISOString();
		return {
			items: rows.map(({ sync, penalty }) => ({
				id: sync.id,
				ip: sync.ip,
				localState: penalty.releasedAt
					? "released"
					: penalty.expiresAt <= now
						? "expired"
						: "active",
				expiresAt: penalty.expiresAt,
				wafState: sync.observedState,
				syncState: sync.syncState,
				reasonCode: sync.reasonCode,
				lastSyncedAt: sync.lastSyncedAt,
				lastAttemptAt: sync.lastAttemptAt,
				suspended: Boolean(sync.suspendedAt),
				updatedAt: sync.updatedAt,
			})),
			totalCount: totals[0]?.total ?? 0,
			limit,
			offset,
		};
	}
	public async requestSync(id: string, restore: boolean) {
		return this.db.transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`waf:${id}`}, 0))`,
			);
			const repository = new WafSyncRepository(tx);
			const row = await repository.get(id);
			if (!row)
				throw new AppError(404, "WAF_RECORD_NOT_FOUND", "未找到访问限制记录。");
			if (row.suspendedAt && !restore)
				throw new AppError(
					409,
					"WAF_REVIEW_REQUIRED",
					"请确认面板中的改动后恢复同步。",
				);
			const now = new Date().toISOString();
			const [updated] = await tx
				.update(wafSyncRecords)
				.set({
					syncState: "pending",
					revision: sql`${wafSyncRecords.revision} + 1`,
					suspendedAt: null,
					restoreRequestedAt: restore ? now : row.restoreRequestedAt,
					sharedIpConfirmedAt: restore ? now : row.sharedIpConfirmedAt,
					claimToken: null,
					claimExpiresAt: null,
					updatedAt: now,
				})
				.where(eq(wafSyncRecords.id, id))
				.returning();
			await new TaskRunRepository(tx).create({
				type: "waf_sync",
				category: "maintenance",
				siteId: row.siteId,
				subjectType: "waf_sync",
				subjectId: id,
				payload: { siteId: row.siteId, recordId: id },
				payloadSummary: { siteId: row.siteId },
				maxAttempts: 3,
				retryDelaySec: 60,
				concurrencyKey: `waf:${row.siteId}`,
				idempotencyKey: `waf-manual:${id}:${updated.revision}`,
			});
			return updated;
		});
	}
	public async pruneCompleted(siteId: number, policy: AbusePolicy, now: Date) {
		const cutoff = new Date(
			now.getTime() -
				Math.max(
					policy.evidenceRetentionDays * 86400000,
					policy.repeatWindowSec * 1000,
				),
		).toISOString();
		const completed = and(
			eq(wafSyncRecords.siteId, siteId),
			eq(wafSyncRecords.desiredState, "absent"),
			eq(wafSyncRecords.observedState, "absent"),
			eq(wafSyncRecords.syncState, "synced"),
			isNull(wafSyncRecords.suspendedAt),
			isNull(wafSyncRecords.claimToken),
		);
		const candidates = await this.db
			.select({ id: wafSyncRecords.id })
			.from(wafSyncRecords)
			.innerJoin(
				securityPenalties,
				eq(securityPenalties.id, wafSyncRecords.penaltyId),
			)
			.where(
				and(
					completed,
					sql`coalesce(${securityPenalties.releasedAt}, ${securityPenalties.expiresAt}) < ${cutoff}::timestamptz`,
				),
			)
			.limit(100);
		if (!candidates.length) return 0;
		const deleted = await this.db
			.delete(wafSyncRecords)
			.where(
				and(
					completed,
					inArray(
						wafSyncRecords.id,
						candidates.map((row) => row.id),
					),
				),
			)
			.returning({ id: wafSyncRecords.id });
		return deleted.length;
	}
	public async resolveSite(siteId: number) {
		const [site] = await this.db
			.select()
			.from(sites)
			.where(eq(sites.id, siteId))
			.limit(1);
		return site ?? null;
	}
}
