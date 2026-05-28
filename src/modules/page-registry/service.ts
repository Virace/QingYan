import { and, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	pageThreads,
	pendingPageCandidates,
	pendingPageViewSessions,
	sitePageRegistry,
} from "../../db/schema";
import { AppError, ResourceNotFoundError } from "../shared/errors";

export class PageRegistryService {
	public constructor(private readonly db: AppDatabase) {}

	public async approvePendingCandidate(input: {
		siteId: number;
		siteKey: string;
		pageKey: string;
	}) {
		const [candidate] = await this.db
			.select()
			.from(pendingPageCandidates)
			.where(
				and(
					eq(pendingPageCandidates.siteKey, input.siteKey),
					eq(pendingPageCandidates.pageKey, input.pageKey),
				),
			)
			.limit(1);
		if (!candidate) {
			throw new ResourceNotFoundError(
				"PENDING_PAGE_NOT_FOUND",
				"待审页面不存在。",
			);
		}
		if (candidate.status !== "pending") {
			throw new AppError(
				409,
				"PENDING_PAGE_NOT_PENDING",
				"待审页面状态不可放行。",
			);
		}

		const nowIso = new Date().toISOString();
		const [pendingCountRow] = await this.db
			.select({ value: sql<number>`COUNT(*)` })
			.from(pendingPageViewSessions)
			.where(
				and(
					eq(pendingPageViewSessions.siteKey, input.siteKey),
					eq(pendingPageViewSessions.pageKey, input.pageKey),
				),
			);
		const mergedPageViews = Number(pendingCountRow?.value ?? 0);

		await this.db
			.insert(sitePageRegistry)
			.values({
				siteId: input.siteId,
				pageKey: input.pageKey,
				pageUrl: candidate.pageUrl,
				status: "active",
				lastSeenAt: nowIso,
				updatedAt: nowIso,
			})
			.onConflictDoUpdate({
				target: [sitePageRegistry.siteId, sitePageRegistry.pageKey],
				set: {
					pageUrl: candidate.pageUrl,
					status: "active",
					lastSeenAt: nowIso,
					trashedAt: null,
					deletedAt: null,
					updatedAt: nowIso,
				},
			});

		await this.db
			.insert(pageThreads)
			.values({
				siteId: input.siteId,
				pageKey: input.pageKey,
				pageUrl: candidate.pageUrl,
				pageViewCount: mergedPageViews,
				updatedAt: nowIso,
			})
			.onConflictDoUpdate({
				target: [pageThreads.siteId, pageThreads.pageKey],
				set: {
					pageUrl: candidate.pageUrl,
					pageViewCount: sql`${pageThreads.pageViewCount} + ${mergedPageViews}`,
					updatedAt: nowIso,
				},
			});

		await this.db
			.update(pendingPageCandidates)
			.set({
				status: "approved",
				updatedAt: nowIso,
			})
			.where(eq(pendingPageCandidates.id, candidate.id));

		return {
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			pageUrl: candidate.pageUrl,
			status: "active",
			mergedPageViews,
		};
	}
}
