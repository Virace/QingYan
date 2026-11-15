import { randomUUID } from "node:crypto";

import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../../db/client";
import {
	captchaSessions,
	commentModeration,
	commentRequestMetadata,
	comments,
	pageThreads,
	voteRecords,
} from "../../db/schema";
import {
	type CommentNotificationIntent,
	enqueueCommentNotificationIntent,
} from "../notifications/comment-notification-intent";
import { hashCommentEmail, renderCommentHtml } from "../shared/comment-content";
import { AppError } from "../shared/errors";
import type { CommentMetadataSnapshot } from "./metadata/resolver";
import type { ModerationReviewResult } from "./moderation-service";
import type { CommentStatus } from "./moderation-types";
import type { CommentAuthorIdentity } from "./verified-author";

export type CaptchaAction = "comment_create" | "comment_vote" | "page_like";
export type CaptchaAuthorization = { sessionId: string; reservationId: string };

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
	public constructor(private readonly db: DatabaseExecutor) {}

	public get database(): DatabaseExecutor {
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
		visitorId?: number | null;
		pageThreadId?: number | null;
		subjectId: string;
		action: CaptchaAction;
		nowIso?: string;
	}) {
		const [session] = await this.db
			.select()
			.from(captchaSessions)
			.where(
				and(
					eq(captchaSessions.siteId, input.siteId),
					eq(captchaSessions.subjectId, input.subjectId),
					eq(captchaSessions.action, input.action),
					isNull(captchaSessions.consumedAt),
					or(
						eq(captchaSessions.verified, false),
						gt(
							captchaSessions.grantExpiresAt,
							input.nowIso ?? new Date().toISOString(),
						),
					),
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
		visitorId: number | null;
		pageThreadId: number | null;
		subjectId: string;
		action: CaptchaAction;
		triggeredBy: "always" | "threshold";
		mode: "inline_value" | "iframe_widget";
		providerKind?: string;
		challengePayloadJson: string;
		providerStateJson?: string;
		expiresAt: string;
	}) {
		const id = input.id ?? createEntityId("cap");
		await this.db.transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`captcha:${input.subjectId}:${input.action}`}, 0))`,
			);
			await tx
				.update(captchaSessions)
				.set({ expiresAt: new Date().toISOString() })
				.where(
					and(
						eq(captchaSessions.subjectId, input.subjectId),
						eq(captchaSessions.action, input.action),
						isNull(captchaSessions.consumedAt),
						or(
							isNull(captchaSessions.reservationId),
							sql`${captchaSessions.reservedUntil} <= CURRENT_TIMESTAMP`,
						),
					),
				);
			await tx.insert(captchaSessions).values({
				id,
				siteId: input.siteId,
				visitorId: input.visitorId,
				subjectId: input.subjectId,
				action: input.action,
				pageThreadId: input.pageThreadId,
				triggeredBy: input.triggeredBy,
				mode: input.mode,
				providerKind: input.providerKind,
				challengePayloadJson: input.challengePayloadJson,
				providerStateJson: input.providerStateJson,
				expiresAt: input.expiresAt,
			});
		});

		return id;
	}
	public async getCaptchaSession(input: {
		siteId: number;
		sessionId: string;
		subjectId?: string;
		widgetOnly?: boolean;
	}) {
		const [session] = await this.db
			.select()
			.from(captchaSessions)
			.where(
				and(
					eq(captchaSessions.id, input.sessionId),
					eq(captchaSessions.siteId, input.siteId),
					input.subjectId
						? eq(captchaSessions.subjectId, input.subjectId)
						: undefined,
					input.widgetOnly
						? eq(captchaSessions.mode, "iframe_widget")
						: undefined,
					isNull(captchaSessions.consumedAt),
					gt(captchaSessions.expiresAt, new Date().toISOString()),
				),
			)
			.limit(1);
		return session;
	}

	public async markCaptchaVerified(sessionId: string) {
		const verified = await this.db
			.update(captchaSessions)
			.set({
				verified: true,
				verifiedAt: new Date().toISOString(),
				grantExpiresAt: new Date(Date.now() + 300000).toISOString(),
				expiresAt: new Date(Date.now() + 300000).toISOString(),
			})
			.where(
				and(
					eq(captchaSessions.id, sessionId),
					eq(captchaSessions.verified, false),
					isNull(captchaSessions.consumedAt),
					gt(captchaSessions.expiresAt, new Date().toISOString()),
				),
			)
			.returning({ id: captchaSessions.id });
		if (!verified.length)
			throw new AppError(
				400,
				"COMMENT_CAPTCHA_REQUIRED",
				"验证码已失效，请重新验证。",
			);
	}

	public async reserveCaptchaAuthorization(
		sessionId: string,
	): Promise<CaptchaAuthorization> {
		const reservationId = randomUUID();
		const nowIso = new Date().toISOString();
		const reserved = await this.db
			.update(captchaSessions)
			.set({
				reservationId,
				reservedUntil: new Date(Date.now() + 120000).toISOString(),
			})
			.where(
				and(
					eq(captchaSessions.id, sessionId),
					eq(captchaSessions.verified, true),
					isNull(captchaSessions.consumedAt),
					gt(captchaSessions.grantExpiresAt, nowIso),
					or(
						isNull(captchaSessions.reservationId),
						sql`${captchaSessions.reservedUntil} <= ${nowIso}`,
					),
				),
			)
			.returning({ id: captchaSessions.id });
		if (!reserved.length)
			throw new AppError(
				400,
				"COMMENT_CAPTCHA_REQUIRED",
				"验证授权已使用或正在处理，请重新验证。",
			);
		return { sessionId, reservationId };
	}
	public async releaseCaptchaAuthorization(
		authorization?: CaptchaAuthorization,
	) {
		if (!authorization) return;
		await this.db
			.update(captchaSessions)
			.set({ reservationId: null, reservedUntil: null })
			.where(
				and(
					eq(captchaSessions.id, authorization.sessionId),
					eq(captchaSessions.reservationId, authorization.reservationId),
					isNull(captchaSessions.consumedAt),
				),
			);
	}
	public async consumeCaptchaAuthorization(
		authorization?: CaptchaAuthorization,
	) {
		if (!authorization) return;
		const nowIso = new Date().toISOString();
		const consumed = await this.db
			.update(captchaSessions)
			.set({ consumedAt: nowIso })
			.where(
				and(
					eq(captchaSessions.id, authorization.sessionId),
					eq(captchaSessions.reservationId, authorization.reservationId),
					isNull(captchaSessions.consumedAt),
					gt(captchaSessions.reservedUntil, nowIso),
					gt(captchaSessions.grantExpiresAt, nowIso),
				),
			)
			.returning({ id: captchaSessions.id });
		if (!consumed.length)
			throw new AppError(
				400,
				"COMMENT_CAPTCHA_REQUIRED",
				"验证授权已过期，请重新验证。",
			);
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
		notification?: Pick<
			CommentNotificationIntent,
			| "siteKey"
			| "pageKey"
			| "source"
			| "notifyBackend"
			| "notifyReply"
			| "actorType"
			| "actorId"
		>;
	}) {
		return this.db.transaction(async (tx) => {
			const commentId = createEntityId("c");
			const nowIso = new Date().toISOString();
			await tx.insert(comments).values({
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
				approvedAt: input.status === "approved" ? nowIso : null,
				approvalSource:
					input.status === "approved"
						? input.authorUserId
							? "staff"
							: "automatic"
						: null,
				approvedByUserId:
					input.status === "approved" ? input.authorUserId : null,
			});
			if (hasRequestMetadata(input)) {
				await tx.insert(commentRequestMetadata).values({
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
				await tx.insert(commentModeration).values({
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
					localReviewJson: input.moderation.localReview
						? JSON.stringify(input.moderation.localReview)
						: undefined,
				});
			}

			if (input.parentCommentId) {
				await tx
					.update(comments)
					.set({
						replyCount: sql`${comments.replyCount} + 1`,
						updatedAt: nowIso,
					})
					.where(eq(comments.id, input.parentCommentId));
			}

			const [thread] = await tx
				.update(pageThreads)
				.set({
					commentCount: sql`${pageThreads.commentCount} + 1`,
					rootCommentCount: input.parentCommentId
						? sql`${pageThreads.rootCommentCount}`
						: sql`${pageThreads.rootCommentCount} + 1`,
					updatedAt: nowIso,
				})
				.where(eq(pageThreads.id, input.pageThreadId))
				.returning();

			if (input.notification)
				await enqueueCommentNotificationIntent(tx, {
					...input.notification,
					siteId: input.siteId,
					commentId,
					status: input.status,
					previousStatus: null,
					authorUserId: input.authorUserId ?? null,
					contentRaw: input.contentRaw,
					createdAt: nowIso,
				});
			return {
				commentId,
				thread,
			};
		});
	}

	public async createVote(input: {
		commentId: string;
		visitorId: number;
		choice: "up" | "down";
	}) {
		return this.db.transaction(async (tx) => {
			const [inserted] = await tx
				.insert(voteRecords)
				.values({
					commentId: input.commentId,
					visitorId: input.visitorId,
					choice: input.choice,
				})
				.onConflictDoNothing({
					target: [voteRecords.commentId, voteRecords.visitorId],
				})
				.returning({ id: voteRecords.id });
			if (!inserted)
				throw new AppError(
					409,
					"VOTE_ALREADY_CAST",
					"你已经投过票，当前不允许再次修改。",
				);

			const [comment] = await tx
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
				.where(eq(comments.id, input.commentId))
				.returning();

			return comment;
		});
	}

	public async incrementCommentVote(input: {
		commentId: string;
		choice: "up" | "down";
	}) {
		const [comment] = await this.db
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
			.where(eq(comments.id, input.commentId))
			.returning();

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
