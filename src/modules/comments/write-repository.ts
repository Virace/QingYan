import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	captchaSessions,
	comments,
	pageThreads,
	voteRecords,
} from "../../db/schema";
import { hashCommentEmail, renderCommentHtml } from "../shared/comment-content";

export type CaptchaAction = "comment_create" | "comment_vote";

function createEntityId(prefix: "c" | "cap"): string {
	return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export class CommentsWriteRepository {
	public constructor(private readonly db: AppDatabase) {}

	public async getCommentById(commentId: string) {
		const [comment] = await this.db
			.select()
			.from(comments)
			.where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
			.limit(1);

		return comment;
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
		siteId: number;
		visitorId: number;
		pageThreadId: number;
		triggeredBy: "always" | "threshold";
		mode: "inline_value";
		challengePayloadJson: string;
		expiresAt: string;
	}) {
		const id = createEntityId("cap");
		await this.db.insert(captchaSessions).values({
			id,
			siteId: input.siteId,
			visitorId: input.visitorId,
			pageThreadId: input.pageThreadId,
			triggeredBy: input.triggeredBy,
			mode: input.mode,
			challengePayloadJson: input.challengePayloadJson,
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

	public async createComment(input: {
		siteId: number;
		pageThreadId: number;
		parentCommentId: string | null;
		visitorId: number;
		authorName: string;
		authorEmail?: string;
		authorWebsite?: string;
		contentRaw: string;
		status: "pending" | "approved";
	}) {
		const commentId = createEntityId("c");
		const nowIso = new Date().toISOString();
		await this.db.insert(comments).values({
			id: commentId,
			siteId: input.siteId,
			pageThreadId: input.pageThreadId,
			parentId: input.parentCommentId,
			visitorId: input.visitorId,
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
