import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { DatabaseExecutor } from "../../db/client";
import { hashKey, toSafeInteger } from "../../db/values";
import {
	adminUsers,
	commentRequestMetadata,
	comments,
	pageFeedbackRecords,
	pageThreads,
	pageViewSessions,
	pendingPageCandidates,
	pendingPageViewSessions,
	sitePageRegistry,
	sites,
	siteSettings,
	visitorRequestMetadata,
	visitors,
	voteRecords,
} from "../../db/schema";
import { assertPageKeyAvailable, lockPageKey } from "../shared/page-key";
import { AppError } from "../shared/errors";
import { normalizePagePath } from "../shared/page-url";
import type {
	RegisteredSiteRecord,
	SiteRegistry,
} from "../shared/site-registry";
import {
	type CommentMetadataSettings,
	defaultCommentMetadata,
} from "../shared/site-settings-defaults";
import type { CommentMetadataSnapshot } from "./metadata/resolver";

export interface VisitorRecord {
	id: number;
	visitorKey: string;
	created: boolean;
}

export interface ThreadRecordInput {
	siteId: number;
	pageKey: string;
	pageTitle?: string;
	pageUrl?: string;
}

export interface PublicCommentsQueryInput {
	pageThreadId: number;
	sortBy: "newest" | "oldest";
	limit: number;
	offset: number;
	visitorId?: number;
}

function hashOptionalValue(value?: string): string | undefined {
	if (!value) {
		return undefined;
	}

	return createHash("sha256").update(value).digest("hex");
}

function createVisitorKey(): string {
	return `visitor_${randomUUID()}`;
}

function mapCommentRequestMetadata(
	comment: typeof comments.$inferSelect,
	metadata: typeof commentRequestMetadata.$inferSelect | null,
	staffUser?: Pick<
		typeof adminUsers.$inferSelect,
		"displayName" | "email" | "website" | "avatarUrl"
	> | null,
) {
	return {
		...comment,
		staffUserDisplayName: staffUser?.displayName ?? null,
		staffUserEmail: staffUser?.email ?? null,
		staffUserWebsite: staffUser?.website ?? null,
		staffUserAvatarUrl: staffUser?.avatarUrl ?? null,
		authorIp: metadata?.authorIp ?? null,
		authorUserAgent: metadata?.authorUserAgent ?? null,
		authorIpCountry: metadata?.ipCountry ?? null,
		authorIpRegion: metadata?.ipRegion ?? null,
		authorIpCity: metadata?.ipCity ?? null,
		authorIpIsp: metadata?.ipIsp ?? null,
		authorIpLocationRaw: metadata?.ipLocationRaw ?? null,
		authorIpLocationSource: metadata?.ipLocationSource ?? null,
		authorIpLocationDbHash: metadata?.ipLocationDbHash ?? null,
		authorIpLocationUpdatedAt: metadata?.ipLocationUpdatedAt ?? null,
		authorIpLocationError: metadata?.ipLocationError ?? null,
		authorDeviceBrowser: metadata?.deviceBrowser ?? null,
		authorDeviceBrowserVersion: metadata?.deviceBrowserVersion ?? null,
		authorDeviceOs: metadata?.deviceOs ?? null,
		authorDeviceOsVersion: metadata?.deviceOsVersion ?? null,
		authorDeviceType: metadata?.deviceType ?? null,
		authorDeviceIcon: metadata?.deviceIcon ?? null,
		authorDeviceSource: metadata?.deviceSource ?? null,
		authorDeviceParserVersion: metadata?.deviceParserVersion ?? null,
		authorDeviceUpdatedAt: metadata?.deviceUpdatedAt ?? null,
		authorDeviceError: metadata?.deviceError ?? null,
	};
}

export class CommentsRepository {
	public constructor(
		private readonly db: DatabaseExecutor,
		private readonly siteRegistry: SiteRegistry,
	) {}

	public getDatabase(): DatabaseExecutor {
		return this.db;
	}

	public getRegisteredSite(siteKey: string): RegisteredSiteRecord | undefined {
		return this.siteRegistry.getRegisteredSite(siteKey);
	}

	public async getSiteSettings(siteId: number) {
		const [settings] = await this.db
			.select()
			.from(siteSettings)
			.where(eq(siteSettings.siteId, siteId))
			.limit(1);

		return settings;
	}

	public resolveCommentMetadata(settings?: {
		commentMetadataJson: string | null;
	}): CommentMetadataSettings {
		if (!settings?.commentMetadataJson) {
			return defaultCommentMetadata;
		}

		try {
			const parsed = JSON.parse(
				settings.commentMetadataJson,
			) as Partial<CommentMetadataSettings>;
			return {
				...defaultCommentMetadata,
				...parsed,
				ipRegion: {
					...defaultCommentMetadata.ipRegion,
					...parsed.ipRegion,
				},
				device: {
					...defaultCommentMetadata.device,
					...parsed.device,
					display: {
						...defaultCommentMetadata.device.display,
						...parsed.device?.display,
					},
				},
			};
		} catch {
			return defaultCommentMetadata;
		}
	}

	public async getOrCreateVisitor(input: {
		siteId: number;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
		metadata?: CommentMetadataSnapshot;
		pageKey?: string;
		pageUrl?: string;
	}): Promise<VisitorRecord> {
		const visitorKey = input.visitorKey ?? createVisitorKey();
		const nowIso = new Date().toISOString();
		return this.db.transaction(async (tx) => {
			const values = {
				siteId: input.siteId,
				visitorKey,
				ipHash: hashOptionalValue(input.ip),
				userAgentHash: hashOptionalValue(input.userAgent),
				lastIp: input.ip,
				lastUserAgent: input.userAgent,
				lastSeenPageKey: input.pageKey,
				lastSeenPageUrl: input.pageUrl,
				lastSeenAt: nowIso,
			};
			const [inserted] = await tx
				.insert(visitors)
				.values(values)
				.onConflictDoNothing({ target: [visitors.siteId, visitors.visitorKey] })
				.returning();
			const [visitor] = inserted
				? [inserted]
				: await tx
						.update(visitors)
						.set(values)
						.where(
							and(
								eq(visitors.siteId, input.siteId),
								eq(visitors.visitorKey, visitorKey),
							),
						)
						.returning();
			if (!visitor) throw new Error("Expected visitor row after upsert");
			await new CommentsRepository(
				tx,
				this.siteRegistry,
			).upsertVisitorRequestMetadata({
				...input,
				visitorId: visitor.id,
				seenAt: nowIso,
			});
			return {
				id: visitor.id,
				visitorKey: visitor.visitorKey,
				created: Boolean(inserted),
			};
		});
	}

	private async upsertVisitorRequestMetadata(input: {
		siteId: number;
		visitorId: number;
		ip?: string;
		userAgent?: string;
		metadata?: CommentMetadataSnapshot;
		pageKey?: string;
		pageUrl?: string;
		seenAt: string;
	}) {
		if (!input.ip && !input.userAgent) {
			return;
		}

		await this.db
			.insert(visitorRequestMetadata)
			.values({
				siteId: input.siteId,
				visitorId: input.visitorId,
				ip: input.ip,
				ipHash: hashOptionalValue(input.ip),
				userAgent: input.userAgent,
				userAgentHash: hashOptionalValue(input.userAgent),
				ipCountry: input.metadata?.authorIpCountry,
				ipRegion: input.metadata?.authorIpRegion,
				ipCity: input.metadata?.authorIpCity,
				ipIsp: input.metadata?.authorIpIsp,
				ipLocationRaw: input.metadata?.authorIpLocationRaw,
				ipLocationSource: input.metadata?.authorIpLocationSource,
				ipLocationDbHash: input.metadata?.authorIpLocationDbHash,
				ipLocationUpdatedAt: input.metadata?.authorIpLocationUpdatedAt,
				ipLocationError: input.metadata?.authorIpLocationError,
				deviceBrowser: input.metadata?.authorDeviceBrowser,
				deviceBrowserVersion: input.metadata?.authorDeviceBrowserVersion,
				deviceOs: input.metadata?.authorDeviceOs,
				deviceOsVersion: input.metadata?.authorDeviceOsVersion,
				deviceType: input.metadata?.authorDeviceType,
				deviceIcon: input.metadata?.authorDeviceIcon,
				deviceSource: input.metadata?.authorDeviceSource,
				deviceParserVersion: input.metadata?.authorDeviceParserVersion,
				deviceUpdatedAt: input.metadata?.authorDeviceUpdatedAt,
				deviceError: input.metadata?.authorDeviceError,
				firstSeenAt: input.seenAt,
				lastSeenAt: input.seenAt,
				seenCount: 1,
				lastSeenPageKey: input.pageKey,
				lastSeenPageUrl: input.pageUrl,
				updatedAt: input.seenAt,
			})
			.onConflictDoUpdate({
				target: [
					visitorRequestMetadata.visitorId,
					visitorRequestMetadata.ipHash,
					visitorRequestMetadata.userAgentHash,
				],
				set: {
					ip: input.ip,
					userAgent: input.userAgent,
					ipCountry: input.metadata?.authorIpCountry,
					ipRegion: input.metadata?.authorIpRegion,
					ipCity: input.metadata?.authorIpCity,
					ipIsp: input.metadata?.authorIpIsp,
					ipLocationRaw: input.metadata?.authorIpLocationRaw,
					ipLocationSource: input.metadata?.authorIpLocationSource,
					ipLocationDbHash: input.metadata?.authorIpLocationDbHash,
					ipLocationUpdatedAt: input.metadata?.authorIpLocationUpdatedAt,
					ipLocationError: input.metadata?.authorIpLocationError,
					deviceBrowser: input.metadata?.authorDeviceBrowser,
					deviceBrowserVersion: input.metadata?.authorDeviceBrowserVersion,
					deviceOs: input.metadata?.authorDeviceOs,
					deviceOsVersion: input.metadata?.authorDeviceOsVersion,
					deviceType: input.metadata?.authorDeviceType,
					deviceIcon: input.metadata?.authorDeviceIcon,
					deviceSource: input.metadata?.authorDeviceSource,
					deviceParserVersion: input.metadata?.authorDeviceParserVersion,
					deviceUpdatedAt: input.metadata?.authorDeviceUpdatedAt,
					deviceError: input.metadata?.authorDeviceError,
					lastSeenAt: input.seenAt,
					seenCount: sql`${visitorRequestMetadata.seenCount} + 1`,
					lastSeenPageKey: input.pageKey,
					lastSeenPageUrl: input.pageUrl,
					updatedAt: input.seenAt,
				},
			});
	}

	public async getOrCreatePageThread(input: ThreadRecordInput) {
		return this.db.transaction(async (tx) => {
			await lockPageKey(tx, input.siteId, input.pageKey);
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

			const normalizedPageUrl = normalizePagePath(input.pageUrl);
			const nowIso = new Date().toISOString();
			const [existingThread] = await tx
				.select()
				.from(pageThreads)
				.where(
					and(
						eq(pageThreads.siteId, input.siteId),
						and(
							eq(pageThreads.pageKeyHash, hashKey(input.pageKey)),
							eq(pageThreads.pageKey, input.pageKey),
						),
					),
				)
				.limit(1);
			if (
				existingThread?.kind !== undefined &&
				existingThread.kind !== "public"
			) {
				throw new AppError(404, "PAGE_NOT_FOUND", "页面不存在。");
			}

			await tx
				.insert(pageThreads)
				.values({
					siteId: input.siteId,
					pageKey: input.pageKey,
					pageKeyHash: hashKey(input.pageKey),
					pageTitle: input.pageTitle,
					pageUrl: normalizedPageUrl,
					kind: "public",
				})
				.onConflictDoUpdate({
					target: [pageThreads.siteId, pageThreads.pageKeyHash],
					setWhere: and(
						eq(pageThreads.pageKeyHash, hashKey(input.pageKey)),
						eq(pageThreads.pageKey, input.pageKey),
					),
					set: {
						pageTitle: input.pageTitle,
						pageUrl: normalizedPageUrl,
						updatedAt: nowIso,
					},
				});
			await tx
				.insert(sitePageRegistry)
				.values({
					siteId: input.siteId,
					pageKey: input.pageKey,
					pageKeyHash: hashKey(input.pageKey),
					pageUrl: normalizedPageUrl ?? input.pageKey,
					title: input.pageTitle,
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
						pageUrl: normalizedPageUrl ?? input.pageKey,
						title: input.pageTitle,
						status: "active",
						lastSeenAt: nowIso,
						updatedAt: nowIso,
					},
				});

			const [thread] = await tx
				.select()
				.from(pageThreads)
				.where(
					and(
						eq(pageThreads.siteId, input.siteId),
						and(
							eq(pageThreads.pageKeyHash, hashKey(input.pageKey)),
							eq(pageThreads.pageKey, input.pageKey),
						),
						eq(pageThreads.kind, "public"),
					),
				)
				.limit(1);

			if (!thread) {
				throw new Error("Expected page thread to exist after upsert");
			}

			return thread;
		});
	}

	public async ensurePageThreadForRegisteredPage(input: ThreadRecordInput) {
		return this.getOrCreatePageThread(input);
	}

	public async getPageThread(input: { siteId: number; pageKey: string }) {
		const [thread] = await this.db
			.select()
			.from(pageThreads)
			.where(
				and(
					eq(pageThreads.siteId, input.siteId),
					and(
						eq(pageThreads.pageKeyHash, hashKey(input.pageKey)),
						eq(pageThreads.pageKey, input.pageKey),
					),
					eq(pageThreads.kind, "public"),
				),
			)
			.limit(1);

		return thread;
	}

	public async getPageRegistryEntry(input: {
		siteId: number;
		pageKey: string;
	}) {
		const [page] = await this.db
			.select()
			.from(sitePageRegistry)
			.where(
				and(
					eq(sitePageRegistry.siteId, input.siteId),
					and(
						eq(sitePageRegistry.pageKeyHash, hashKey(input.pageKey)),
						eq(sitePageRegistry.pageKey, input.pageKey),
					),
				),
			)
			.limit(1);

		return page;
	}

	public async assertPageInteractive(input: {
		siteId: number;
		pageKey: string;
	}) {
		const page = await this.getPageRegistryEntry(input);
		if (!page) {
			throw new AppError(403, "PAGE_NOT_REGISTERED", "页面尚未登记。");
		}
		if (page.status !== "active") {
			throw new AppError(403, "PAGE_NOT_INTERACTIVE", "页面当前不可交互。");
		}
	}

	public async recordPageView(input: {
		pageThreadId: number;
		visitorId: number;
		pageKey: string;
		userAgent?: string;
		windowMs?: number;
	}) {
		const fingerprint = createHash("sha256")
			.update(`${input.visitorId}:${input.pageKey}:${input.userAgent ?? ""}`)
			.digest("hex");
		const windowMs = input.windowMs ?? 60 * 60 * 1000;
		const nowIso = new Date().toISOString();
		const cutoff = new Date(Date.now() - windowMs).toISOString();
		await this.db.transaction(async (tx) => {
			const [session] = await tx
				.insert(pageViewSessions)
				.values({
					pageThreadId: input.pageThreadId,
					visitorId: input.visitorId,
					fingerprint,
					seenAt: nowIso,
				})
				.onConflictDoUpdate({
					target: [pageViewSessions.pageThreadId, pageViewSessions.fingerprint],
					set: { seenAt: nowIso },
					setWhere: sql`${pageViewSessions.seenAt} <= ${cutoff}`,
				})
				.returning({ id: pageViewSessions.id });
			if (session)
				await tx
					.update(pageThreads)
					.set({
						pageViewCount: sql`${pageThreads.pageViewCount} + 1`,
						updatedAt: nowIso,
					})
					.where(eq(pageThreads.id, input.pageThreadId));
		});
	}

	public async recordLightweightPageView(input: { pageThreadId: number }) {
		const nowIso = new Date().toISOString();
		await this.db
			.update(pageThreads)
			.set({
				pageViewCount: sql`${pageThreads.pageViewCount} + 1`,
				updatedAt: nowIso,
			})
			.where(eq(pageThreads.id, input.pageThreadId));
	}

	public async recordLightweightPendingPageView(input: {
		siteKey: string;
		pageKey: string;
		pageUrl: string;
	}) {
		return this.db.transaction(async (tx) => {
			const target = await this.resolvePendingPageViewTarget(tx, input);
			if (target.kind === "protected") return;
			if (target.kind === "registered") {
				await new CommentsRepository(
					tx,
					this.siteRegistry,
				).recordLightweightPageView({ pageThreadId: target.threadId });
				return;
			}

			const nowIso = new Date().toISOString();
			await tx
				.insert(pendingPageCandidates)
				.values({
					siteKey: input.siteKey,
					pageKey: input.pageKey,
					pageKeyHash: hashKey(input.pageKey),
					pageUrl: input.pageUrl,
					hitCount: 1,
					lastSeenAt: nowIso,
					updatedAt: nowIso,
				})
				.onConflictDoUpdate({
					target: [
						pendingPageCandidates.siteKey,
						pendingPageCandidates.pageKeyHash,
					],
					setWhere: and(
						eq(pendingPageCandidates.pageKeyHash, hashKey(input.pageKey)),
						eq(pendingPageCandidates.pageKey, input.pageKey),
					),
					set: {
						pageUrl: input.pageUrl,
						hitCount: sql`${pendingPageCandidates.hitCount} + 1`,
						lastSeenAt: nowIso,
						updatedAt: nowIso,
					},
				});
		});
	}

	public async recordPendingPageView(input: {
		siteKey: string;
		pageKey: string;
		pageUrl: string;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
		windowMs?: number;
	}) {
		return this.db.transaction(async (tx) => {
			const target = await this.resolvePendingPageViewTarget(tx, input);
			if (target.kind === "protected") return;

			const nowIso = new Date().toISOString();
			if (target.kind === "pending")
				await tx
					.insert(pendingPageCandidates)
					.values({
						siteKey: input.siteKey,
						pageKey: input.pageKey,
						pageKeyHash: hashKey(input.pageKey),
						pageUrl: input.pageUrl,
						hitCount: 1,
						lastSeenAt: nowIso,
						updatedAt: nowIso,
					})
					.onConflictDoUpdate({
						target: [
							pendingPageCandidates.siteKey,
							pendingPageCandidates.pageKeyHash,
						],
						setWhere: and(
							eq(pendingPageCandidates.pageKeyHash, hashKey(input.pageKey)),
							eq(pendingPageCandidates.pageKey, input.pageKey),
						),
						set: {
							pageUrl: input.pageUrl,
							hitCount: sql`${pendingPageCandidates.hitCount} + 1`,
							lastSeenAt: nowIso,
							updatedAt: nowIso,
						},
					});

			const fingerprint = createHash("sha256")
				.update(
					`${input.visitorKey ?? input.ip ?? "anonymous"}:${input.pageKey}:${input.userAgent ?? ""}`,
				)
				.digest("hex");
			const cutoff = new Date(
				Date.now() - (input.windowMs ?? 60 * 60 * 1000),
			).toISOString();
			const [session] = await tx
				.insert(pendingPageViewSessions)
				.values({
					siteKey: input.siteKey,
					pageKey: input.pageKey,
					pageKeyHash: hashKey(input.pageKey),
					fingerprint,
					lastSeenAt: nowIso,
					updatedAt: nowIso,
				})
				.onConflictDoUpdate({
					target: [
						pendingPageViewSessions.siteKey,
						pendingPageViewSessions.pageKeyHash,
						pendingPageViewSessions.fingerprint,
					],
					set: {
						hitCount: sql`${pendingPageViewSessions.hitCount} + 1`,
						lastSeenAt: nowIso,
						updatedAt: nowIso,
					},
					setWhere: and(
						and(
							eq(pendingPageViewSessions.pageKeyHash, hashKey(input.pageKey)),
							eq(pendingPageViewSessions.pageKey, input.pageKey),
						),
						sql`${pendingPageViewSessions.lastSeenAt} <= ${cutoff}`,
					),
				})
				.returning({ id: pendingPageViewSessions.id });
			if (session && target.kind === "registered") {
				await tx
					.update(pageThreads)
					.set({
						pageViewCount: sql`${pageThreads.pageViewCount} + 1`,
						updatedAt: nowIso,
					})
					.where(eq(pageThreads.id, target.threadId));
			}
		});
	}

	private async resolvePendingPageViewTarget(
		tx: DatabaseExecutor,
		input: { siteKey: string; pageKey: string; pageUrl: string },
	): Promise<
		{ kind: "pending" | "protected" } | { kind: "registered"; threadId: number }
	> {
		const [site] = await tx
			.select({ id: sites.id })
			.from(sites)
			.where(eq(sites.siteKey, input.siteKey));
		if (site) await lockPageKey(tx, site.id, input.pageKey);
		await lockPageKey(tx, input.siteKey, input.pageKey);
		await assertPageKeyAvailable(
			tx,
			"pending_page_candidates",
			input.siteKey,
			input.pageKey,
		);
		await assertPageKeyAvailable(
			tx,
			"pending_page_view_sessions",
			input.siteKey,
			input.pageKey,
		);
		if (!site) return { kind: "pending" };
		const repository = new CommentsRepository(tx, this.siteRegistry);
		const page = await repository.getPageRegistryEntry({
			siteId: site.id,
			pageKey: input.pageKey,
		});
		if (!page) return { kind: "pending" };
		if (page.status !== "active") return { kind: "protected" };
		const thread = await repository.ensurePageThreadForRegisteredPage({
			siteId: site.id,
			pageKey: input.pageKey,
			pageUrl: page.pageUrl,
		});
		return { kind: "registered", threadId: thread.id };
	}

	public async listPublicComments(input: PublicCommentsQueryInput) {
		const orderBy =
			input.sortBy === "oldest"
				? asc(comments.createdAt)
				: desc(comments.createdAt);
		const replies = alias(comments, "public_comment_replies");
		const visibleComments = and(
			eq(comments.pageThreadId, input.pageThreadId),
			eq(pageThreads.kind, "public"),
			eq(comments.status, "approved"),
			isNull(comments.deletedAt),
		);
		// 总数包含全部已公开评论，返回树仅沿当前页可见的父节点展开。
		const commentPage = sql`(
			WITH RECURSIVE public_comment_counts AS (
				SELECT COUNT(*) AS total_count,
					COUNT(*) FILTER (WHERE ${comments.parentId} IS NULL) AS root_count
				FROM ${comments}
				INNER JOIN ${pageThreads} ON ${pageThreads.id} = ${comments.pageThreadId}
				WHERE ${visibleComments}
			), public_comment_roots AS (
				SELECT ${comments.id}
				FROM ${comments}
				INNER JOIN ${pageThreads} ON ${pageThreads.id} = ${comments.pageThreadId}
				WHERE ${and(visibleComments, isNull(comments.parentId))}
				ORDER BY ${orderBy}, ${asc(comments.id)}
				LIMIT ${input.limit} OFFSET ${input.offset}
			), public_comment_tree(id) AS (
				SELECT id FROM public_comment_roots
				UNION ALL
				SELECT ${replies.id}
				FROM ${comments} AS ${replies}
				INNER JOIN public_comment_tree ON ${replies.parentId} = public_comment_tree.id
				WHERE ${and(
					eq(replies.pageThreadId, input.pageThreadId),
					eq(replies.status, "approved"),
					isNull(replies.deletedAt),
				)}
			)
			SELECT public_comment_counts.*, public_comment_tree.id AS comment_id
			FROM public_comment_counts
			LEFT JOIN public_comment_tree ON true
		) AS public_comment_page`;
		const rows = await this.db
			.select({
				totalCount: sql`public_comment_page.total_count`.mapWith(toSafeInteger),
				rootCount: sql`public_comment_page.root_count`.mapWith(toSafeInteger),
				comment: comments,
				metadata: commentRequestMetadata,
				staffUser: {
					displayName: adminUsers.displayName,
					email: adminUsers.email,
					website: adminUsers.website,
					avatarUrl: adminUsers.avatarUrl,
				},
				viewerVote: voteRecords.choice,
			})
			.from(commentPage)
			.leftJoin(comments, sql`${comments.id} = public_comment_page.comment_id`)
			.leftJoin(
				commentRequestMetadata,
				eq(commentRequestMetadata.commentId, comments.id),
			)
			.leftJoin(adminUsers, eq(adminUsers.id, comments.authorUserId))
			.leftJoin(
				voteRecords,
				input.visitorId
					? and(
							eq(voteRecords.commentId, comments.id),
							eq(voteRecords.visitorId, input.visitorId),
						)
					: sql`false`,
			)
			.orderBy(orderBy, asc(comments.id));
		const selectedComments = rows.flatMap((row) =>
			row.comment
				? [mapCommentRequestMetadata(row.comment, row.metadata, row.staffUser)]
				: [],
		);
		const viewerVoteMap = new Map<string, "up" | "down">();
		for (const row of rows) {
			if (row.comment && row.viewerVote) {
				viewerVoteMap.set(row.comment.id, row.viewerVote as "up" | "down");
			}
		}

		return {
			totalCount: rows[0]?.totalCount ?? 0,
			rootCount: rows[0]?.rootCount ?? 0,
			comments: selectedComments,
			viewerVoteMap,
		};
	}

	public async getViewerPageFeedback(pageThreadId: number, visitorId?: number) {
		if (!visitorId) {
			return {
				liked: false,
			};
		}

		const [record] = await this.db
			.select()
			.from(pageFeedbackRecords)
			.where(
				and(
					eq(pageFeedbackRecords.pageThreadId, pageThreadId),
					eq(pageFeedbackRecords.visitorId, visitorId),
				),
			)
			.limit(1);

		return {
			liked: record !== undefined,
		};
	}
}
