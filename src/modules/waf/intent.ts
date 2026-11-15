import { isIP } from "node:net";
import { eq, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../../db/client";
import { type securityPenalties, wafSyncRecords } from "../../db/schema";
import { TaskRunRepository } from "../tasks/task-run-repository";

export async function saveWafSyncIntent(
	db: DatabaseExecutor,
	penalty: typeof securityPenalties.$inferSelect,
	enabled = true,
) {
	if (!enabled || !isIP(penalty.ip)) return;
	const now = new Date().toISOString();
	const id = `waf_${penalty.id}`;
	const desiredState =
		penalty.releasedAt || penalty.expiresAt <= now ? "absent" : "present";
	await db
		.insert(wafSyncRecords)
		.values({
			id,
			penaltyId: penalty.id,
			siteId: penalty.siteId,
			ip: penalty.ip,
			penaltyVersion: penalty.stateVersion,
			ruleName: `qingyan-${penalty.id}`,
			expiresAt: penalty.expiresAt,
			desiredState,
		})
		.onConflictDoUpdate({
			target: wafSyncRecords.penaltyId,
			set: {
				penaltyVersion: penalty.stateVersion,
				revision: sql`${wafSyncRecords.revision} + 1`,
				desiredState,
				expiresAt: penalty.expiresAt,
				syncState: sql`CASE WHEN ${wafSyncRecords.suspendedAt} IS NULL THEN 'pending' ELSE 'conflict' END`,
				claimToken: null,
				claimExpiresAt: null,
				updatedAt: now,
			},
			setWhere: sql`${wafSyncRecords.penaltyVersion} < ${penalty.stateVersion}`,
		});
	if (process.env.QINGYAN_WAF_SYNC_PAUSED === "true") return;
	await new TaskRunRepository(db).create({
		type: "waf_sync",
		category: "maintenance",
		siteId: penalty.siteId,
		subjectType: "waf_sync",
		subjectId: id,
		payload: { siteId: penalty.siteId, recordId: id },
		payloadSummary: { siteId: penalty.siteId },
		maxAttempts: 3,
		retryDelaySec: 60,
		concurrencyKey: `waf:${penalty.siteId}`,
		idempotencyKey: `waf:${penalty.id}:${penalty.stateVersion}`,
	});
}

export async function releaseWafSyncIntent(
	db: DatabaseExecutor,
	penalty: typeof securityPenalties.$inferSelect,
) {
	const [existing] = await db
		.select({ id: wafSyncRecords.id })
		.from(wafSyncRecords)
		.where(eq(wafSyncRecords.penaltyId, penalty.id))
		.limit(1);
	if (existing) await saveWafSyncIntent(db, penalty);
}
