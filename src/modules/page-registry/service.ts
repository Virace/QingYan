import { and, desc, eq, notExists, or, sql } from "drizzle-orm";

import type { DatabaseExecutor } from "../../db/client";
import { hashKey, toSafeInteger } from "../../db/values";
import {
	pageThreads,
	pendingPageCandidates,
	pendingPageViewSessions,
	sitePageRegistry,
	sites,
} from "../../db/schema";
import { assertPageKeyAvailable, lockPageKey } from "../shared/page-key";
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
	public constructor(private readonly db: DatabaseExecutor) {}

	public async listPendingCandidates(input: {
		siteKey?: string;
		status?: "pending" | "approved" | "rejected" | "ignored";
		search?: string;
		limit: number;
		offset: number;
	}) {
		const searchValue = input.search ? `%${input.search}%` : undefined;
		const status = input.status ?? "pending";
		const whereClause = and(
			input.siteKey
				? eq(pendingPageCandidates.siteKey, input.siteKey)
				: undefined,
			eq(pendingPageCandidates.status, status),
			searchValue
				? or(
						sql`${pendingPageCandidates.pageKey} COLLATE "C" ILIKE ${searchValue} ESCAPE ''`,
						sql`${pendingPageCandidates.pageUrl} COLLATE "C" ILIKE ${searchValue} ESCAPE ''`,
					)
				: undefined,
			status === "pending"
				? notExists(
						this.db
							.select({ id: sitePageRegistry.id })
							.from(sitePageRegistry)
							.innerJoin(sites, eq(sites.id, sitePageRegistry.siteId))
							.where(
								and(
									eq(sites.siteKey, pendingPageCandidates.siteKey),
									eq(
										sitePageRegistry.pageKeyHash,
										pendingPageCandidates.pageKeyHash,
									),
									eq(sitePageRegistry.pageKey, pendingPageCandidates.pageKey),
									or(
										eq(sitePageRegistry.status, "active"),
										eq(sitePageRegistry.status, "stale"),
									),
								),
							),
					)
				: undefined,
		);
		const candidateCount = this.db
			.select({
				totalCount: sql`COUNT(*)`.mapWith(toSafeInteger).as("total_count"),
			})
			.from(pendingPageCandidates)
			.where(whereClause)
			.as("pending_candidate_count");
		const candidatePage = this.db
			.select()
			.from(pendingPageCandidates)
			.where(whereClause)
			.orderBy(
				desc(pendingPageCandidates.updatedAt),
				desc(pendingPageCandidates.id),
			)
			.limit(input.limit)
			.offset(input.offset)
			.as("pending_candidate_page");
		// 空页仍保留总数，计数与分页结果共享同一查询快照。
		const rows = await this.db
			.select()
			.from(candidatePage)
			.rightJoin(candidateCount, sql`true`)
			.orderBy(desc(candidatePage.updatedAt), desc(candidatePage.id));
		return {
			items: rows.flatMap(({ pending_candidate_page: candidate }) => {
				if (!candidate) return [];
				const { pageKeyHash: _pageKeyHash, ...record } = candidate;
				return [record];
			}),
			totalCount: rows[0]?.pending_candidate_count.totalCount ?? 0,
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
						and(
							eq(pendingPageCandidates.pageKeyHash, hashKey(pageKey)),
							eq(pendingPageCandidates.pageKey, pageKey),
						),
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
					and(
						eq(sitePageRegistry.pageKeyHash, pendingPageCandidates.pageKeyHash),
						eq(sitePageRegistry.pageKey, pendingPageCandidates.pageKey),
					),
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
						and(
							eq(pendingPageViewSessions.pageKeyHash, hashKey(row.pageKey)),
							eq(pendingPageViewSessions.pageKey, row.pageKey),
						),
					),
				);
			const mergedPageViews = toSafeInteger(pendingCountRow?.value ?? 0);
			const [thread] = await this.db
				.select()
				.from(pageThreads)
				.where(
					and(
						eq(pageThreads.siteId, row.siteId),
						and(
							eq(pageThreads.pageKeyHash, hashKey(row.pageKey)),
							eq(pageThreads.pageKey, row.pageKey),
						),
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

			await this.approvePendingCandidateForSite({
				siteId: row.siteId,
				siteKey: row.siteKey,
				pageKey: row.pageKey,
				pageUrl: row.registryPageUrl || row.candidatePageUrl,
				candidateId: row.candidateId,
			});
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
					and(
						eq(pendingPageCandidates.pageKeyHash, hashKey(input.pageKey)),
						eq(pendingPageCandidates.pageKey, input.pageKey),
					),
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
		return this.db.transaction(async (tx) => {
			await lockPageKey(tx, input.siteId, input.pageKey);
			await lockPageKey(tx, input.siteKey, input.pageKey);
			await assertPageKeyAvailable(
				tx,
				"page_threads",
				input.siteId,
				input.pageKey,
			);
			await assertPageKeyAvailable(
				tx,
				"site_page_registry",
				input.siteId,
				input.pageKey,
			);
			const [candidate] = await tx
				.select()
				.from(pendingPageCandidates)
				.where(
					and(
						eq(pendingPageCandidates.siteKey, input.siteKey),
						and(
							eq(pendingPageCandidates.pageKeyHash, hashKey(input.pageKey)),
							eq(pendingPageCandidates.pageKey, input.pageKey),
						),
					),
				)
				.for("update");
			if (
				input.candidateId !== undefined &&
				(!candidate ||
					candidate.id !== input.candidateId ||
					candidate.status !== "pending")
			) {
				throw new AppError(
					409,
					"PENDING_PAGE_NOT_PENDING",
					"待审页面状态不可放行。",
				);
			}
			const nowIso = new Date().toISOString();
			const [pendingCountRow] = await tx
				.select({ value: sql<string>`COUNT(*)` })
				.from(pendingPageViewSessions)
				.where(
					and(
						eq(pendingPageViewSessions.siteKey, input.siteKey),
						and(
							eq(pendingPageViewSessions.pageKeyHash, hashKey(input.pageKey)),
							eq(pendingPageViewSessions.pageKey, input.pageKey),
						),
					),
				);
			const [existingThread] = await tx
				.select({ id: pageThreads.id })
				.from(pageThreads)
				.where(
					and(
						eq(pageThreads.siteId, input.siteId),
						and(
							eq(pageThreads.pageKeyHash, hashKey(input.pageKey)),
							eq(pageThreads.pageKey, input.pageKey),
						),
					),
				);
			const mergedPageViews =
				candidate?.status === "pending" || (!candidate && !existingThread)
					? toSafeInteger(pendingCountRow?.value ?? 0)
					: 0;

			await tx
				.insert(sitePageRegistry)
				.values({
					siteId: input.siteId,
					pageKey: input.pageKey,
					pageKeyHash: hashKey(input.pageKey),
					pageUrl: input.pageUrl,
					status: "active",
					lastSeenAt: nowIso,
					updatedAt: nowIso,
				})
				.onConflictDoUpdate({
					target: [sitePageRegistry.siteId, sitePageRegistry.pageKeyHash],
					setWhere: and(
						eq(sitePageRegistry.pageKeyHash, hashKey(input.pageKey)),
						eq(sitePageRegistry.pageKey, input.pageKey),
					),
					set: {
						pageUrl: input.pageUrl,
						status: "active",
						lastSeenAt: nowIso,
						trashedAt: null,
						deletedAt: null,
						updatedAt: nowIso,
					},
				});

			await tx
				.insert(pageThreads)
				.values({
					siteId: input.siteId,
					pageKey: input.pageKey,
					pageKeyHash: hashKey(input.pageKey),
					pageUrl: input.pageUrl,
					pageViewCount: mergedPageViews,
					updatedAt: nowIso,
				})
				.onConflictDoUpdate({
					target: [pageThreads.siteId, pageThreads.pageKeyHash],
					setWhere: and(
						eq(pageThreads.pageKeyHash, hashKey(input.pageKey)),
						eq(pageThreads.pageKey, input.pageKey),
					),
					set: {
						pageUrl: input.pageUrl,
						pageViewCount: sql`${pageThreads.pageViewCount} + ${mergedPageViews}`,
						updatedAt: nowIso,
					},
				});

			if (candidate?.status === "pending") {
				await tx
					.update(pendingPageCandidates)
					.set({
						status: "approved",
						updatedAt: nowIso,
					})
					.where(eq(pendingPageCandidates.id, candidate.id));
			}

			return {
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				pageUrl: input.pageUrl,
				status: "active",
				mergedPageViews,
			};
		});
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
					and(
						eq(pendingPageCandidates.pageKeyHash, hashKey(input.pageKey)),
						eq(pendingPageCandidates.pageKey, input.pageKey),
					),
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
		return this.db.transaction(async (tx) => {
			await lockPageKey(tx, input.siteId, input.pageKey);
			await assertPageKeyAvailable(
				tx,
				"site_page_registry",
				input.siteId,
				input.pageKey,
			);

			const nowIso = new Date().toISOString();
			const candidate = await new PageRegistryService(tx).getPendingCandidate(
				input,
			);
			await tx
				.update(pendingPageCandidates)
				.set({
					status: "ignored",
					lastRejectReason: input.reason ?? null,
					updatedAt: nowIso,
				})
				.where(eq(pendingPageCandidates.id, candidate.id));
			await tx
				.insert(sitePageRegistry)
				.values({
					siteId: input.siteId,
					pageKey: input.pageKey,
					pageKeyHash: hashKey(input.pageKey),
					pageUrl: candidate.pageUrl,
					title: null,
					status: "ignored",
					lastSeenAt: nowIso,
					updatedAt: nowIso,
				})
				.onConflictDoUpdate({
					target: [sitePageRegistry.siteId, sitePageRegistry.pageKeyHash],
					setWhere: and(
						eq(sitePageRegistry.pageKeyHash, hashKey(input.pageKey)),
						eq(sitePageRegistry.pageKey, input.pageKey),
					),
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
		});
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

	public async clearTrash(input: { siteId?: number; siteKey?: string }) {
		const nowIso = new Date().toISOString();
		const whereClause = and(
			input.siteId ? eq(sitePageRegistry.siteId, input.siteId) : undefined,
			eq(sitePageRegistry.status, "trash"),
		);
		const rows = await this.db
			.select({
				pageKey: sitePageRegistry.pageKey,
				pageUrl: sitePageRegistry.pageUrl,
			})
			.from(sitePageRegistry)
			.where(whereClause);
		if (rows.length > 0) {
			await this.db
				.update(sitePageRegistry)
				.set({
					status: "deleted",
					deletedAt: nowIso,
					updatedAt: nowIso,
				})
				.where(whereClause);
		}

		return {
			deletedCount: rows.length,
			pages: rows,
		};
	}

	public async restoreDeletedPage(input: {
		pageKey: string;
		siteId?: number | null;
		siteKey?: string;
	}) {
		const page = await this.setPageLifecycle(
			{
				...input,
				siteId: input.siteId ?? undefined,
			},
			"active",
		);
		return {
			...page,
			restoredCount: 1,
		};
	}

	public async restoreDeletedPages(input: {
		pageKeys: string[];
		siteId?: number | null;
	}) {
		if (input.pageKeys.length === 0) {
			return 0;
		}
		let restoredCount = 0;
		for (const pageKey of input.pageKeys) {
			try {
				await this.restoreDeletedPage({
					pageKey,
					siteId: input.siteId,
				});
				restoredCount += 1;
			} catch (error) {
				if (error instanceof ResourceNotFoundError) {
					continue;
				}
				throw error;
			}
		}
		return restoredCount;
	}

	public async hardDeletePage(input: {
		pageKey: string;
		siteId?: number | null;
	}) {
		const existing = await this.findPage(input);
		await this.db
			.delete(sitePageRegistry)
			.where(eq(sitePageRegistry.id, existing.id));
		return 1;
	}

	public async hardDeletePages(input: {
		pageKeys: string[];
		siteId?: number | null;
	}) {
		if (input.pageKeys.length === 0) {
			return 0;
		}
		let hardDeletedCount = 0;
		for (const pageKey of input.pageKeys) {
			try {
				hardDeletedCount += await this.hardDeletePage({
					pageKey,
					siteId: input.siteId,
				});
			} catch (error) {
				if (error instanceof ResourceNotFoundError) {
					continue;
				}
				throw error;
			}
		}
		return hardDeletedCount;
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
					and(
						eq(pendingPageCandidates.pageKeyHash, hashKey(input.pageKey)),
						eq(pendingPageCandidates.pageKey, input.pageKey),
					),
				),
			)
			.limit(1);
		if (!candidate) {
			throw new ResourceNotFoundError(
				"PENDING_PAGE_NOT_FOUND",
				"待审页面不存在。",
			);
		}
		const { pageKeyHash: _pageKeyHash, ...record } = candidate;
		return record;
	}

	private async setPageLifecycle(
		input: { pageKey: string; siteId?: number; siteKey?: string },
		status: "active" | "trash" | "deleted",
	) {
		const nowIso = new Date().toISOString();
		const page = await this.findPage(input);
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

	private async findPage(input: { pageKey: string; siteId?: number | null }) {
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
					and(
						eq(sitePageRegistry.pageKeyHash, hashKey(input.pageKey)),
						eq(sitePageRegistry.pageKey, input.pageKey),
					),
				),
			)
			.limit(1);
		if (!page) {
			throw new ResourceNotFoundError("PAGE_NOT_FOUND", "页面不存在。");
		}
		return page;
	}
}
