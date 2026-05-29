import { and, desc, eq, like, or, sql } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	pageThreads,
	pendingPageCandidates,
	pendingPageViewSessions,
	sitePageRegistry,
	sites,
} from "../../db/schema";
import { AppError, ResourceNotFoundError } from "../shared/errors";

type ReconcileRegisteredPendingCandidatesInput = {
	siteKey?: string;
	pageKeys?: string[];
	dryRun?: boolean;
};

type ReconcileRegisteredPendingCandidatesSummary = {
	matchedCandidates: number;
	createdThreads: number;
	reusedThreads: number;
	mergedPendingPv: number;
	approvedCandidates: number;
};

export class PageRegistryService {
	public constructor(private readonly db: AppDatabase) {}

	public async listPendingCandidates(input: {
		siteKey?: string;
		status?: "pending" | "approved" | "rejected" | "ignored";
		search?: string;
		limit: number;
		offset: number;
	}) {
		const searchValue = input.search ? `%${input.search}%` : undefined;
		const status = input.status ?? "pending";
		const rows = await this.db
			.select()
			.from(pendingPageCandidates)
			.where(
				and(
					input.siteKey
						? eq(pendingPageCandidates.siteKey, input.siteKey)
						: undefined,
					eq(pendingPageCandidates.status, status),
					searchValue
						? or(
								like(pendingPageCandidates.pageKey, searchValue),
								like(pendingPageCandidates.pageUrl, searchValue),
							)
						: undefined,
				),
			)
			.orderBy(desc(pendingPageCandidates.updatedAt));
		const filteredRows =
			status === "pending"
				? await this.excludeRegisteredPendingCandidates(rows)
				: rows;

		return {
			items: filteredRows.slice(input.offset, input.offset + input.limit),
			totalCount: filteredRows.length,
		};
	}

	public async reconcileRegisteredPendingCandidates(
		input: ReconcileRegisteredPendingCandidatesInput = {},
	): Promise<ReconcileRegisteredPendingCandidatesSummary> {
		const emptySummary: ReconcileRegisteredPendingCandidatesSummary = {
			matchedCandidates: 0,
			createdThreads: 0,
			reusedThreads: 0,
			mergedPendingPv: 0,
			approvedCandidates: 0,
		};
		if (input.pageKeys?.length === 0) {
			return emptySummary;
		}

		const pageKeyFilter = input.pageKeys
			? or(
					...input.pageKeys.map((pageKey) =>
						eq(pendingPageCandidates.pageKey, pageKey),
					),
				)
			: undefined;
		const rows = await this.db
			.select({
				candidateId: pendingPageCandidates.id,
				siteId: sites.id,
				siteKey: sites.siteKey,
				pageKey: pendingPageCandidates.pageKey,
				candidatePageUrl: pendingPageCandidates.pageUrl,
				registryPageUrl: sitePageRegistry.pageUrl,
			})
			.from(pendingPageCandidates)
			.innerJoin(sites, eq(sites.siteKey, pendingPageCandidates.siteKey))
			.innerJoin(
				sitePageRegistry,
				and(
					eq(sitePageRegistry.siteId, sites.id),
					eq(sitePageRegistry.pageKey, pendingPageCandidates.pageKey),
				),
			)
			.where(
				and(
					eq(pendingPageCandidates.status, "pending"),
					input.siteKey
						? eq(pendingPageCandidates.siteKey, input.siteKey)
						: undefined,
					pageKeyFilter,
					or(
						eq(sitePageRegistry.status, "active"),
						eq(sitePageRegistry.status, "stale"),
					),
				),
			);

		const summary = { ...emptySummary };
		for (const row of rows) {
			summary.matchedCandidates += 1;

			const [pendingCountRow] = await this.db
				.select({ value: sql<number>`COUNT(*)` })
				.from(pendingPageViewSessions)
				.where(
					and(
						eq(pendingPageViewSessions.siteKey, row.siteKey),
						eq(pendingPageViewSessions.pageKey, row.pageKey),
					),
				);
			const mergedPageViews = Number(pendingCountRow?.value ?? 0);
			const [thread] = await this.db
				.select()
				.from(pageThreads)
				.where(
					and(
						eq(pageThreads.siteId, row.siteId),
						eq(pageThreads.pageKey, row.pageKey),
					),
				)
				.limit(1);

			if (thread) {
				summary.reusedThreads += 1;
			} else {
				summary.createdThreads += 1;
			}
			summary.mergedPendingPv += mergedPageViews;
			summary.approvedCandidates += 1;

			if (input.dryRun) {
				continue;
			}

			const nowIso = new Date().toISOString();
			const pageUrl = row.registryPageUrl || row.candidatePageUrl;
			if (thread) {
				await this.db
					.update(pageThreads)
					.set({
						pageUrl,
						pageViewCount: sql`${pageThreads.pageViewCount} + ${mergedPageViews}`,
						updatedAt: nowIso,
					})
					.where(eq(pageThreads.id, thread.id));
			} else {
				await this.db.insert(pageThreads).values({
					siteId: row.siteId,
					pageKey: row.pageKey,
					pageUrl,
					pageViewCount: mergedPageViews,
					updatedAt: nowIso,
				});
			}

			await this.db
				.update(pendingPageCandidates)
				.set({
					status: "approved",
					updatedAt: nowIso,
				})
				.where(eq(pendingPageCandidates.id, row.candidateId));
		}

		return summary;
	}

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

		return this.approvePendingCandidateForSite({
			...input,
			pageUrl: candidate.pageUrl,
			candidateId: candidate.id,
		});
	}

	public async approvePendingCandidateForSite(input: {
		siteId: number;
		siteKey: string;
		pageKey: string;
		pageUrl: string;
		candidateId?: number;
	}) {
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
				pageUrl: input.pageUrl,
				status: "active",
				lastSeenAt: nowIso,
				updatedAt: nowIso,
			})
			.onConflictDoUpdate({
				target: [sitePageRegistry.siteId, sitePageRegistry.pageKey],
				set: {
					pageUrl: input.pageUrl,
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
				pageUrl: input.pageUrl,
				pageViewCount: mergedPageViews,
				updatedAt: nowIso,
			})
			.onConflictDoUpdate({
				target: [pageThreads.siteId, pageThreads.pageKey],
				set: {
					pageUrl: input.pageUrl,
					pageViewCount: sql`${pageThreads.pageViewCount} + ${mergedPageViews}`,
					updatedAt: nowIso,
				},
			});

		if (input.candidateId !== undefined) {
			await this.db
				.update(pendingPageCandidates)
				.set({
					status: "approved",
					updatedAt: nowIso,
				})
				.where(eq(pendingPageCandidates.id, input.candidateId));
		}

		return {
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			pageUrl: input.pageUrl,
			status: "active",
			mergedPageViews,
		};
	}

	public async approvePendingCandidateIfPending(input: {
		siteId: number;
		siteKey: string;
		pageKey: string;
		pageUrl: string;
	}) {
		const [candidate] = await this.db
			.select()
			.from(pendingPageCandidates)
			.where(
				and(
					eq(pendingPageCandidates.siteKey, input.siteKey),
					eq(pendingPageCandidates.pageKey, input.pageKey),
					eq(pendingPageCandidates.status, "pending"),
				),
			)
			.limit(1);
		if (!candidate) {
			return null;
		}
		return this.approvePendingCandidateForSite({
			...input,
			candidateId: candidate.id,
		});
	}

	public async rejectPendingCandidate(input: {
		siteKey: string;
		pageKey: string;
		reason?: string;
	}) {
		const nowIso = new Date().toISOString();
		const candidate = await this.getPendingCandidate(input);
		await this.db
			.update(pendingPageCandidates)
			.set({
				status: "rejected",
				lastRejectReason: input.reason ?? null,
				updatedAt: nowIso,
			})
			.where(eq(pendingPageCandidates.id, candidate.id));
		return {
			...candidate,
			status: "rejected",
			lastRejectReason: input.reason ?? null,
			updatedAt: nowIso,
		};
	}

	public async ignorePendingCandidate(input: {
		siteId: number;
		siteKey: string;
		pageKey: string;
		reason?: string;
	}) {
		const nowIso = new Date().toISOString();
		const candidate = await this.getPendingCandidate(input);
		await this.db
			.update(pendingPageCandidates)
			.set({
				status: "ignored",
				lastRejectReason: input.reason ?? null,
				updatedAt: nowIso,
			})
			.where(eq(pendingPageCandidates.id, candidate.id));
		await this.db
			.insert(sitePageRegistry)
			.values({
				siteId: input.siteId,
				pageKey: input.pageKey,
				pageUrl: candidate.pageUrl,
				title: null,
				status: "ignored",
				lastSeenAt: nowIso,
				updatedAt: nowIso,
			})
			.onConflictDoUpdate({
				target: [sitePageRegistry.siteId, sitePageRegistry.pageKey],
				set: {
					pageUrl: candidate.pageUrl,
					status: "ignored",
					lastSeenAt: nowIso,
					updatedAt: nowIso,
				},
			});

		return {
			candidate: {
				...candidate,
				status: "ignored",
				lastRejectReason: input.reason ?? null,
				updatedAt: nowIso,
			},
			page: {
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				pageUrl: candidate.pageUrl,
				status: "ignored",
			},
		};
	}

	public async trashPage(input: {
		pageKey: string;
		siteId?: number;
		siteKey?: string;
	}) {
		return this.setPageLifecycle(input, "trash");
	}

	public async restorePage(input: {
		pageKey: string;
		siteId?: number;
		siteKey?: string;
	}) {
		return this.setPageLifecycle(input, "active");
	}

	public async deletePage(input: {
		pageKey: string;
		siteId?: number;
		siteKey?: string;
	}) {
		return this.setPageLifecycle(input, "deleted");
	}

	private async getPendingCandidate(input: {
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
		return candidate;
	}

	private async excludeRegisteredPendingCandidates(
		rows: Array<typeof pendingPageCandidates.$inferSelect>,
	) {
		const filteredRows: Array<typeof pendingPageCandidates.$inferSelect> = [];
		for (const row of rows) {
			const [registeredPage] = await this.db
				.select({ id: sitePageRegistry.id })
				.from(sitePageRegistry)
				.innerJoin(sites, eq(sites.id, sitePageRegistry.siteId))
				.where(
					and(
						eq(sites.siteKey, row.siteKey),
						eq(sitePageRegistry.pageKey, row.pageKey),
						or(
							eq(sitePageRegistry.status, "active"),
							eq(sitePageRegistry.status, "stale"),
						),
					),
				)
				.limit(1);
			if (!registeredPage) {
				filteredRows.push(row);
			}
		}
		return filteredRows;
	}

	private async setPageLifecycle(
		input: { pageKey: string; siteId?: number; siteKey?: string },
		status: "active" | "trash" | "deleted",
	) {
		const nowIso = new Date().toISOString();
		const [page] = await this.db
			.select({
				id: sitePageRegistry.id,
				siteId: sitePageRegistry.siteId,
				siteKey: sites.siteKey,
				pageKey: sitePageRegistry.pageKey,
				pageUrl: sitePageRegistry.pageUrl,
			})
			.from(sitePageRegistry)
			.innerJoin(sites, eq(sites.id, sitePageRegistry.siteId))
			.where(
				and(
					input.siteId ? eq(sitePageRegistry.siteId, input.siteId) : undefined,
					eq(sitePageRegistry.pageKey, input.pageKey),
				),
			)
			.limit(1);
		if (!page) {
			throw new ResourceNotFoundError("PAGE_NOT_FOUND", "页面不存在。");
		}
		await this.db
			.update(sitePageRegistry)
			.set({
				status,
				trashedAt: status === "trash" ? nowIso : null,
				deletedAt: status === "deleted" ? nowIso : null,
				updatedAt: nowIso,
			})
			.where(eq(sitePageRegistry.id, page.id));

		return {
			siteKey: input.siteKey ?? page.siteKey,
			pageKey: page.pageKey,
			pageUrl: page.pageUrl,
			status,
			trashedAt: status === "trash" ? nowIso : null,
			deletedAt: status === "deleted" ? nowIso : null,
			updatedAt: nowIso,
		};
	}
}
