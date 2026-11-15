import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { and, eq, gt, lt } from "drizzle-orm";
import type { AppDatabase } from "../../db/client";
import {
	commentRequestMetadata,
	comments,
	siteSettings,
	wafLogCursors,
	wafLogEvents,
} from "../../db/schema";
import { readAbusePolicy } from "../comments/abuse-policy";
import { AbuseRepository } from "../comments/abuse-repository";
import type { WafSiteMapping } from "./config";
import type { WafGatewayClient, WafLog } from "./gateway-client";
import { saveWafSyncIntent } from "./intent";
import { WafSyncRepository } from "./repository";
import { isKnownScan } from "./rules";

const MAX_LOG_PAGES = 20;
const OVERLAP_MS = 10 * 60000;

function hostname(value: string): string {
	try {
		const url = new URL(`http://${value}`);
		return url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
			? ""
			: url.hostname.toLowerCase();
	} catch {
		return "";
	}
}

export class WafLogIngestor {
	public constructor(
		private readonly db: AppDatabase,
		private readonly client: Pick<WafGatewayClient, "logs">,
	) {}

	public async collect(
		siteId: number | null,
		mapping: WafSiteMapping | null,
		now = new Date(),
	) {
		if (process.env.QINGYAN_WAF_SYNC_PAUSED === "true")
			return { status: "paused", inserted: 0, gap: null };
		const websiteKey = mapping?.websiteKey ?? "unknown";
		const [cursor] = await this.db
			.select()
			.from(wafLogCursors)
			.where(eq(wafLogCursors.websiteKey, websiteKey))
			.limit(1);
		const previous = cursor?.highWaterId ?? 0;
		const [settings] = siteId
			? await this.db
					.select({ policy: siteSettings.abusePolicyJson })
					.from(siteSettings)
					.where(eq(siteSettings.siteId, siteId))
					.limit(1)
			: [];
		const retentionCutoff = new Date(
			now.getTime() -
				readAbusePolicy(settings?.policy).evidenceRetentionDays * 86400000,
		).toISOString();
		let newest = 0;
		let inserted = 0;
		let gap: string | null = null;
		let reachedBoundary = false;
		let reachedPrevious = false;
		for (let page = 1; page <= MAX_LOG_PAGES; page++) {
			const result = await this.client.logs(websiteKey, page);
			if (page === 1) {
				newest = Math.max(0, ...result.items.map((event) => event.id));
				if (previous > 0 && newest < previous)
					gap = "source_reset_or_retention";
			}
			for (const event of result.items) {
				if (
					!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
						event.localtime,
					) ||
					!Number.isFinite(Date.parse(event.localtime))
				) {
					gap = "event_timezone_unknown";
					continue;
				}
				if (!isIP(event.ip)) {
					gap = "invalid_event";
					continue;
				}
				if (
					mapping &&
					!mapping.hosts.some((host) => hostname(host) === hostname(event.host))
				) {
					gap = "site_scope_mismatch";
					continue;
				}
				if (Date.parse(event.localtime) >= Date.parse(retentionCutoff))
					inserted += await this.persist(event, siteId, mapping, now);
				if (event.id <= previous) reachedPrevious = true;
				if (
					event.id <= previous &&
					Date.parse(event.localtime) < now.getTime() - OVERLAP_MS
				)
					reachedBoundary = true;
			}
			if (
				result.items.length < 100 ||
				page * 100 >= result.total ||
				reachedBoundary
			) {
				reachedBoundary = true;
				break;
			}
		}
		if (!reachedBoundary) gap = "page_limit";
		else if (previous > 0 && newest >= previous && !reachedPrevious && !gap)
			gap = "source_reset_or_retention";
		const lastGap = gap ?? cursor?.gapReason ?? null;
		await this.db
			.insert(wafLogCursors)
			.values({
				websiteKey,
				highWaterId: newest,
				lastPollAt: now.toISOString(),
				gapReason: lastGap,
			})
			.onConflictDoUpdate({
				target: wafLogCursors.websiteKey,
				set: {
					highWaterId: newest,
					lastPollAt: now.toISOString(),
					gapReason: lastGap,
					updatedAt: now.toISOString(),
				},
			});
		await this.db
			.delete(wafLogEvents)
			.where(
				and(
					siteId
						? eq(wafLogEvents.siteId, siteId)
						: eq(wafLogEvents.websiteKey, websiteKey),
					lt(wafLogEvents.occurredAt, retentionCutoff),
				),
			);
		return { status: "completed", inserted, gap };
	}

	private async persist(
		event: WafLog,
		siteId: number | null,
		mapping: WafSiteMapping | null,
		now: Date,
	) {
		const occurredAt = new Date(event.localtime).toISOString();
		const path = event.uri.split("?", 1)[0].slice(0, 1000);
		const id = createHash("sha256")
			.update(
				JSON.stringify([
					mapping?.websiteKey ?? "unknown",
					event.id,
					occurredAt,
					event.ip,
					event.execRule,
					event.action,
					path,
				]),
			)
			.digest("hex");
		return this.db.transaction(async (tx) => {
			const linked = siteId
				? await tx
						.select({ id: comments.id })
						.from(comments)
						.innerJoin(
							commentRequestMetadata,
							eq(commentRequestMetadata.commentId, comments.id),
						)
						.where(
							and(
								eq(comments.siteId, siteId),
								eq(commentRequestMetadata.authorIp, event.ip),
								gt(
									comments.createdAt,
									new Date(Date.parse(occurredAt) - 2000).toISOString(),
								),
								lt(
									comments.createdAt,
									new Date(Date.parse(occurredAt) + 2000).toISOString(),
								),
							),
						)
						.limit(2)
				: [];
			const [created] = await tx
				.insert(wafLogEvents)
				.values({
					id,
					siteId,
					sourceId: event.id,
					websiteKey: mapping?.websiteKey ?? "unknown",
					ip: event.ip,
					host: hostname(event.host).slice(0, 253),
					path,
					ruleType: event.execRule.slice(0, 100),
					action: event.action.slice(0, 30),
					occurredAt,
					commentId: linked.length === 1 ? linked[0].id : null,
					confidence: linked.length === 1 ? "ip_time_low" : "unlinked",
					decision: mapping ? "observed" : "instance_evidence_only",
				})
				.onConflictDoNothing()
				.returning({ id: wafLogEvents.id });
			if (!created || !siteId || !mapping?.autoBanScans || !isKnownScan(event))
				return created ? 1 : 0;
			const [settings] = await tx
				.select({ policy: siteSettings.abusePolicyJson })
				.from(siteSettings)
				.where(eq(siteSettings.siteId, siteId))
				.limit(1);
			const policy = readAbusePolicy(settings?.policy);
			if (!policy.syncToWaf) return 1;
			if (
				Date.parse(occurredAt) + 1296000000 <= now.getTime() ||
				Date.parse(occurredAt) > now.getTime() + 60000
			)
				return 1;
			const repository = new WafSyncRepository(tx);
			if (await repository.isIpAllowlisted(siteId, event.ip, now)) {
				await tx
					.update(wafLogEvents)
					.set({ decision: "allowlisted" })
					.where(eq(wafLogEvents.id, id));
				return 1;
			}
			const shared = await repository.hasSharedIp(siteId, event.ip);
			if (shared) {
				await tx
					.update(wafLogEvents)
					.set({ decision: "shared_ip_review" })
					.where(eq(wafLogEvents.id, id));
				return 1;
			}
			const penalty = await new AbuseRepository(tx).createPenalty({
				siteId,
				ip: event.ip,
				scope: "all",
				reason: "waf_scan",
				policy: {
					...policy,
					penaltyTtlSec: 1296000,
					repeatPenaltyTtlSec: 1296000,
				},
				count: 1,
				now: Date.parse(occurredAt),
				violationObservedAt: Date.parse(occurredAt),
			});
			if (penalty.releasedAt) {
				await tx
					.update(wafLogEvents)
					.set({ decision: "before_manual_release" })
					.where(eq(wafLogEvents.id, id));
				return 1;
			}
			await saveWafSyncIntent(tx, penalty, true);
			await tx
				.update(wafLogEvents)
				.set({ decision: "scanner_penalty" })
				.where(eq(wafLogEvents.id, id));
			return 1;
		});
	}
}
