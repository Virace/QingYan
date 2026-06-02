import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	captchaSessions,
	commentModeration,
	commentRequestMetadata,
	comments,
	pageThreads,
	voteRecords,
} from "../../db/schema";
import { hashCommentEmail, renderCommentHtml } from "../shared/comment-content";
import type { CommentMetadataSnapshot } from "./metadata/resolver";
import type { CommentStatus } from "./moderation-types";
import type { ModerationReviewResult } from "./moderation-service";
import type { CommentAuthorIdentity } from "./verified-author";

export type CaptchaAction = "comment_create" | "comment_vote" | "page_like";

function createEntityId(prefix: "c" | "cap"): string {
	return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function hasRequestMetadata(input: {
	authorIp?: string;
	authorUserAgent?: string;
	metadata?: CommentMetadataSnapshot;
}) {
	return Boolean(
		input.authorIp ||
			input.authorUserAgent ||
			Object.values(input.metadata ?? {}).some(
				(value) => value !== undefined && value !== null,
			),
	);
}

function mapCommentRequestMetadata(
	comment: typeof comments.$inferSelect,
	metadata: typeof commentRequestMetadata.$inferSelect | null,
) {
	return {
		...comment,
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

export class CommentsWriteRepository {
	public constructor(private readonly db: AppDatabase) {}

	public get database(): AppDatabase {
		return this.db;
	}

	public createCaptchaSessionId() {
		return createEntityId("cap");
	}

	public async getCommentById(commentId: string) {
		const [row] = await this.db
			.select({
				comment: comments,
				metadata: commentRequestMetadata,
			})
			.from(comments)
			.leftJoin(
				commentRequestMetadata,
				eq(commentRequestMetadata.commentId, comments.id),
			)
			.where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
			.limit(1);

		return row
			? mapCommentRequestMetadata(row.comment, row.metadata)
			: undefined;
	}

	public async getActiveCaptchaSession(input: {
		siteId: number;
		visitorId: number;
		pageThreadId: number;
		nowIso?: string;
	}) {
		const [session] = await this.db
			.select()
			.from(captchaSessions)
			.where(
				and(
					eq(captchaSessions.siteId, input.siteId),
					eq(captchaSessions.visitorId, input.visitorId),
					eq(captchaSessions.pageThreadId, input.pageThreadId),
					sql`${captchaSessions.expiresAt} >= ${
						input.nowIso ?? new Date().toISOString()
					}`,
				),
			)
			.orderBy(desc(captchaSessions.createdAt))
			.limit(1);

		return session;
	}

	public async createCaptchaSession(input: {
		id?: string;
		siteId: number;
		visitorId: number;
		pageThreadId: number;
		triggeredBy: "always" | "threshold";
		mode: "inline_value" | "iframe_widget";
		providerKind?: string;
		challengePayloadJson: string;
		providerStateJson?: string;
		expiresAt: string;
	}) {
		const id = input.id ?? createEntityId("cap");
		await this.db.insert(captchaSessions).values({
			id,
			siteId: input.siteId,
			visitorId: input.visitorId,
			pageThreadId: input.pageThreadId,
			triggeredBy: input.triggeredBy,
			mode: input.mode,
			providerKind: input.providerKind,
			challengePayloadJson: input.challengePayloadJson,
			providerStateJson: input.providerStateJson,
			expiresAt: input.expiresAt,
		});

		return id;
	}

	public async markCaptchaVerified(sessionId: string) {
		await this.db
			.update(captchaSessions)
			.set({
				verified: true,
				verifiedAt: new Date().toISOString(),
			})
			.where(eq(captchaSessions.id, sessionId));
	}

	public async expireCaptchaSession(
		sessionId: string,
		nowIso = new Date().toISOString(),
	) {
		await this.db
			.update(captchaSessions)
			.set({
				expiresAt: nowIso,
			})
			.where(eq(captchaSessions.id, sessionId));
	}

	public async createComment(input: {
		siteId: number;
		pageThreadId: number;
		parentCommentId: string | null;
		visitorId: number | null;
		authorUserId?: number | null;
		authorIdentity?: CommentAuthorIdentity;
		authorName: string;
		authorEmail?: string;
		authorWebsite?: string;
		authorIp?: string;
		authorUserAgent?: string;
		metadata?: CommentMetadataSnapshot;
		contentRaw: string;
		status: CommentStatus;
		moderation?: ModerationReviewResult;
	}) {
		const commentId = createEntityId("c");
		const nowIso = new Date().toISOString();
		await this.db.insert(comments).values({
			id: commentId,
			siteId: input.siteId,
			pageThreadId: input.pageThreadId,
			parentId: input.parentCommentId,
			visitorId: input.visitorId,
			authorUserId: input.authorUserId,
			authorIdentity: input.authorIdentity ?? "visitor",
			status: input.status,
			authorName: input.authorName,
			authorEmail: input.authorEmail,
			authorEmailHash: hashCommentEmail(input.authorEmail),
			authorWebsite: input.authorWebsite,
			contentRaw: input.contentRaw,
			contentHtml: renderCommentHtml(input.contentRaw),
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: nowIso,
			updatedAt: nowIso,
		});
		if (hasRequestMetadata(input)) {
			await this.db.insert(commentRequestMetadata).values({
				commentId,
				authorIp: input.authorIp,
				authorUserAgent: input.authorUserAgent,
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
				createdAt: nowIso,
				updatedAt: nowIso,
			});
		}
		if (input.moderation) {
			await this.db.insert(commentModeration).values({
				commentId,
				provider: input.moderation.provider,
				mode: input.moderation.mode,
				decision: input.moderation.decision,
				status: input.moderation.status,
				reason: input.moderation.reason,
				akismetVerdict: input.moderation.akismetVerdict,
				akismetProTip: input.moderation.akismetProTip,
				akismetRecheckAfterSec: input.moderation.akismetRecheckAfterSec,
				akismetDebugHelp: input.moderation.akismetDebugHelp,
				checkedAt: input.moderation.checkedAt,
				requestSnapshotJson: input.moderation.requestSnapshot
					? JSON.stringify({
							...input.moderation.requestSnapshot,
							apiKey: undefined,
						})
					: undefined,
			});
		}

		if (input.parentCommentId) {
			await this.db
				.update(comments)
				.set({
					replyCount: sql`${comments.replyCount} + 1`,
					updatedAt: nowIso,
				})
				.where(eq(comments.id, input.parentCommentId));
		}

		await this.db
			.update(pageThreads)
			.set({
				commentCount: sql`${pageThreads.commentCount} + 1`,
				rootCommentCount: input.parentCommentId
					? sql`${pageThreads.rootCommentCount}`
					: sql`${pageThreads.rootCommentCount} + 1`,
				updatedAt: nowIso,
			})
			.where(eq(pageThreads.id, input.pageThreadId));

		const [thread] = await this.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.id, input.pageThreadId))
			.limit(1);

		return {
			commentId,
			thread,
		};
	}

	public async createVote(input: {
		commentId: string;
		visitorId: number;
		choice: "up" | "down";
	}) {
		await this.db.insert(voteRecords).values({
			commentId: input.commentId,
			visitorId: input.visitorId,
			choice: input.choice,
		});

		await this.db
			.update(comments)
			.set({
				voteUpCount:
					input.choice === "up"
						? sql`${comments.voteUpCount} + 1`
						: sql`${comments.voteUpCount}`,
				voteDownCount:
					input.choice === "down"
						? sql`${comments.voteDownCount} + 1`
						: sql`${comments.voteDownCount}`,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(comments.id, input.commentId));

		const [comment] = await this.db
			.select()
			.from(comments)
			.where(eq(comments.id, input.commentId))
			.limit(1);

		return comment;
	}

	public async incrementCommentVote(input: {
		commentId: string;
		choice: "up" | "down";
	}) {
		await this.db
			.update(comments)
			.set({
				voteUpCount:
					input.choice === "up"
						? sql`${comments.voteUpCount} + 1`
						: sql`${comments.voteUpCount}`,
				voteDownCount:
					input.choice === "down"
						? sql`${comments.voteDownCount} + 1`
						: sql`${comments.voteDownCount}`,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(comments.id, input.commentId));

		const [comment] = await this.db
			.select()
			.from(comments)
			.where(eq(comments.id, input.commentId))
			.limit(1);

		return comment;
	}

	public async getVoteRecord(commentId: string, visitorId: number) {
		const [voteRecord] = await this.db
			.select()
			.from(voteRecords)
			.where(
				and(
					eq(voteRecords.commentId, commentId),
					eq(voteRecords.visitorId, visitorId),
				),
			)
			.limit(1);

		return voteRecord;
	}
}
