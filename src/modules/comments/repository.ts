import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	commentRequestMetadata,
	comments,
	adminUsers,
	pageFeedbackRecords,
	pageThreads,
	pageViewSessions,
	pendingPageCandidates,
	pendingPageViewSessions,
	sitePageRegistry,
	siteSettings,
	visitorRequestMetadata,
	visitors,
	voteRecords,
} from "../../db/schema";
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
		private readonly db: AppDatabase,
		private readonly siteRegistry: SiteRegistry,
	) {}

	public getDatabase(): AppDatabase {
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
		const [existingVisitor] = await this.db
			.select()
			.from(visitors)
			.where(
				and(
					eq(visitors.siteId, input.siteId),
					eq(visitors.visitorKey, visitorKey),
				),
			)
			.limit(1);

		if (existingVisitor) {
			await this.db
				.update(visitors)
				.set({
					ipHash: hashOptionalValue(input.ip),
					userAgentHash: hashOptionalValue(input.userAgent),
					lastIp: input.ip,
					lastUserAgent: input.userAgent,
					lastSeenPageKey: input.pageKey,
					lastSeenPageUrl: input.pageUrl,
					lastSeenAt: nowIso,
				})
				.where(eq(visitors.id, existingVisitor.id));
			await this.upsertVisitorRequestMetadata({
				...input,
				visitorId: existingVisitor.id,
				seenAt: nowIso,
			});

			return {
				id: existingVisitor.id,
				visitorKey: existingVisitor.visitorKey,
				created: false,
			};
		}

		await this.db.insert(visitors).values({
			siteId: input.siteId,
			visitorKey,
			ipHash: hashOptionalValue(input.ip),
			userAgentHash: hashOptionalValue(input.userAgent),
			lastIp: input.ip,
			lastUserAgent: input.userAgent,
			lastSeenPageKey: input.pageKey,
			lastSeenPageUrl: input.pageUrl,
			lastSeenAt: nowIso,
		});

		const [createdVisitor] = await this.db
			.select()
			.from(visitors)
			.where(
				and(
					eq(visitors.siteId, input.siteId),
					eq(visitors.visitorKey, visitorKey),
				),
			)
			.limit(1);

		if (!createdVisitor) {
			throw new Error("Expected visitor row to exist after insertion");
		}
		await this.upsertVisitorRequestMetadata({
			...input,
			visitorId: createdVisitor.id,
			seenAt: nowIso,
		});

		return {
			id: createdVisitor.id,
			visitorKey: createdVisitor.visitorKey,
			created: true,
		};
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
		const normalizedPageUrl = normalizePagePath(input.pageUrl);
		const nowIso = new Date().toISOString();

		await this.db
			.insert(pageThreads)
			.values({
				siteId: input.siteId,
				pageKey: input.pageKey,
				pageTitle: input.pageTitle,
				pageUrl: normalizedPageUrl,
			})
			.onConflictDoUpdate({
				target: [pageThreads.siteId, pageThreads.pageKey],
				set: {
					pageTitle: input.pageTitle,
					pageUrl: normalizedPageUrl,
					updatedAt: nowIso,
				},
			});
		await this.db
			.insert(sitePageRegistry)
			.values({
				siteId: input.siteId,
				pageKey: input.pageKey,
				pageUrl: normalizedPageUrl ?? input.pageKey,
				title: input.pageTitle,
				status: "active",
				lastSeenAt: nowIso,
				updatedAt: nowIso,
			})
			.onConflictDoUpdate({
				target: [sitePageRegistry.siteId, sitePageRegistry.pageKey],
				set: {
					pageUrl: normalizedPageUrl ?? input.pageKey,
					title: input.pageTitle,
					status: "active",
					lastSeenAt: nowIso,
					updatedAt: nowIso,
				},
			});

		const [thread] = await this.db
			.select()
			.from(pageThreads)
			.where(
				and(
					eq(pageThreads.siteId, input.siteId),
					eq(pageThreads.pageKey, input.pageKey),
				),
			)
			.limit(1);

		if (!thread) {
			throw new Error("Expected page thread to exist after upsert");
		}

		return thread;
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
					eq(pageThreads.pageKey, input.pageKey),
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
					eq(sitePageRegistry.pageKey, input.pageKey),
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
		if (
			page?.status === "trash" ||
			page?.status === "deleted" ||
			page?.status === "ignored"
		) {
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
		const [existingSession] = await this.db
			.select()
			.from(pageViewSessions)
			.where(
				and(
					eq(pageViewSessions.pageThreadId, input.pageThreadId),
					eq(pageViewSessions.fingerprint, fingerprint),
				),
			)
			.limit(1);

		const nowIso = new Date().toISOString();
		if (!existingSession) {
			await this.db.insert(pageViewSessions).values({
				pageThreadId: input.pageThreadId,
				visitorId: input.visitorId,
				fingerprint,
				seenAt: nowIso,
			});
			await this.db
				.update(pageThreads)
				.set({
					pageViewCount: sql`${pageThreads.pageViewCount} + 1`,
					updatedAt: nowIso,
				})
				.where(eq(pageThreads.id, input.pageThreadId));

			return;
		}

		const lastSeenAt = new Date(existingSession.seenAt).getTime();
		if (!Number.isNaN(lastSeenAt) && Date.now() - lastSeenAt < windowMs) {
			return;
		}

		await this.db
			.update(pageViewSessions)
			.set({
				seenAt: nowIso,
			})
			.where(eq(pageViewSessions.id, existingSession.id));
		await this.db
			.update(pageThreads)
			.set({
				pageViewCount: sql`${pageThreads.pageViewCount} + 1`,
				updatedAt: nowIso,
			})
			.where(eq(pageThreads.id, input.pageThreadId));
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
		const nowIso = new Date().toISOString();
		await this.db
			.insert(pendingPageCandidates)
			.values({
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				pageUrl: input.pageUrl,
				hitCount: 1,
				lastSeenAt: nowIso,
				updatedAt: nowIso,
			})
			.onConflictDoUpdate({
				target: [pendingPageCandidates.siteKey, pendingPageCandidates.pageKey],
				set: {
					pageUrl: input.pageUrl,
					hitCount: sql`${pendingPageCandidates.hitCount} + 1`,
					lastSeenAt: nowIso,
					updatedAt: nowIso,
				},
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
		const nowIso = new Date().toISOString();
		await this.db
			.insert(pendingPageCandidates)
			.values({
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				pageUrl: input.pageUrl,
				hitCount: 1,
				lastSeenAt: nowIso,
				updatedAt: nowIso,
			})
			.onConflictDoUpdate({
				target: [pendingPageCandidates.siteKey, pendingPageCandidates.pageKey],
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
		const [existingSession] = await this.db
			.select()
			.from(pendingPageViewSessions)
			.where(
				and(
					eq(pendingPageViewSessions.siteKey, input.siteKey),
					eq(pendingPageViewSessions.pageKey, input.pageKey),
					eq(pendingPageViewSessions.fingerprint, fingerprint),
				),
			)
			.limit(1);

		if (!existingSession) {
			await this.db.insert(pendingPageViewSessions).values({
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				fingerprint,
				lastSeenAt: nowIso,
				updatedAt: nowIso,
			});
			return;
		}

		const windowMs = input.windowMs ?? 60 * 60 * 1000;
		const lastSeenAt = new Date(existingSession.lastSeenAt).getTime();
		if (!Number.isNaN(lastSeenAt) && Date.now() - lastSeenAt < windowMs) {
			return;
		}

		await this.db
			.update(pendingPageViewSessions)
			.set({
				hitCount: sql`${pendingPageViewSessions.hitCount} + 1`,
				lastSeenAt: nowIso,
				updatedAt: nowIso,
			})
			.where(eq(pendingPageViewSessions.id, existingSession.id));
	}

	public async listPublicComments(input: PublicCommentsQueryInput) {
		const orderBy =
			input.sortBy === "oldest"
				? asc(comments.createdAt)
				: desc(comments.createdAt);
		const rows = await this.db
			.select({
				comment: comments,
				metadata: commentRequestMetadata,
				staffUser: {
					displayName: adminUsers.displayName,
					email: adminUsers.email,
					website: adminUsers.website,
					avatarUrl: adminUsers.avatarUrl,
				},
			})
			.from(comments)
			.leftJoin(
				commentRequestMetadata,
				eq(commentRequestMetadata.commentId, comments.id),
			)
			.leftJoin(adminUsers, eq(adminUsers.id, comments.authorUserId))
			.where(
				and(
					eq(comments.pageThreadId, input.pageThreadId),
					eq(comments.status, "approved"),
					isNull(comments.deletedAt),
				),
			)
			.orderBy(orderBy);
		const allApprovedComments = rows.map((row) =>
			mapCommentRequestMetadata(row.comment, row.metadata, row.staffUser),
		);

		const rootComments = allApprovedComments.filter(
			(comment) => comment.parentId === null,
		);
		const paginatedRootComments = rootComments.slice(
			input.offset,
			input.offset + input.limit,
		);
		const includedCommentIds = new Set<string>(
			paginatedRootComments.map((comment) => comment.id),
		);

		let changed = true;
		while (changed) {
			changed = false;
			for (const comment of allApprovedComments) {
				if (
					comment.parentId &&
					includedCommentIds.has(comment.parentId) &&
					!includedCommentIds.has(comment.id)
				) {
					includedCommentIds.add(comment.id);
					changed = true;
				}
			}
		}

		const selectedComments = allApprovedComments.filter((comment) =>
			includedCommentIds.has(comment.id),
		);
		const viewerVoteMap = new Map<string, "up" | "down">();

		if (input.visitorId && selectedComments.length > 0) {
			const viewerVotes = await this.db
				.select()
				.from(voteRecords)
				.where(
					and(
						eq(voteRecords.visitorId, input.visitorId),
						inArray(
							voteRecords.commentId,
							selectedComments.map((comment) => comment.id),
						),
					),
				);

			for (const voteRecord of viewerVotes) {
				viewerVoteMap.set(
					voteRecord.commentId,
					voteRecord.choice as "up" | "down",
				);
			}
		}

		return {
			totalCount: allApprovedComments.length,
			rootCount: rootComments.length,
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
