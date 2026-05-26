import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	comments,
	pageFeedbackRecords,
	pageViewSessions,
	pageThreads,
	siteSettings,
	visitors,
	voteRecords,
} from "../../db/schema";
import type {
	RegisteredSiteRecord,
	SiteRegistry,
} from "../shared/site-registry";
import { normalizePagePath } from "../shared/page-url";
import {
	defaultCommentMetadata,
	type CommentMetadataSettings,
} from "../shared/site-settings-defaults";

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
	}): Promise<VisitorRecord> {
		const visitorKey = input.visitorKey ?? createVisitorKey();
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
					lastSeenAt: new Date().toISOString(),
				})
				.where(eq(visitors.id, existingVisitor.id));

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

		return {
			id: createdVisitor.id,
			visitorKey: createdVisitor.visitorKey,
			created: true,
		};
	}

	public async getOrCreatePageThread(input: ThreadRecordInput) {
		const normalizedPageUrl = normalizePagePath(input.pageUrl);

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
					updatedAt: new Date().toISOString(),
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

	public async listPublicComments(input: PublicCommentsQueryInput) {
		const orderBy =
			input.sortBy === "oldest"
				? asc(comments.createdAt)
				: desc(comments.createdAt);
		const allApprovedComments = await this.db
			.select()
			.from(comments)
			.where(
				and(
					eq(comments.pageThreadId, input.pageThreadId),
					eq(comments.status, "approved"),
					isNull(comments.deletedAt),
				),
			)
			.orderBy(orderBy);

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
