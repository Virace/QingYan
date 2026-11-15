import { and, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../../db/client";
import { commentRequestMetadata, comments } from "../../db/schema";
import { hashCommentEmail } from "../shared/comment-content";
import { isNumericComment } from "./email-policy";

export type LocalReviewEvidence = {
	policyVersion: "local-review-v1";
	decision: "approved" | "pending";
	reason: "local_history_sufficient" | "local_history_insufficient";
	matureDays: number;
	manualApproval: boolean;
	staffInteraction: boolean;
	matchedHistoryCount: number;
};

function activeStaff(actor: SQL, siteId: number) {
	return sql`EXISTS (SELECT 1 FROM admin_users au JOIN admin_user_groups aug ON aug.user_id = au.id JOIN admin_groups ag ON ag.id = aug.group_id WHERE au.id = ${actor} AND au.status = 'active' AND au.deleted_at IS NULL AND ag.key IN ('admin','site_admin','site_moderator') AND (ag.key = 'admin' OR EXISTS (SELECT 1 FROM admin_user_site_access asa WHERE asa.user_id = au.id AND asa.site_id = ${siteId})))`;
}

export class LocalReviewService {
	public constructor(private readonly db: DatabaseExecutor) {}
	public async evaluate(input: {
		siteId: number;
		authorName: string;
		authorEmail?: string;
		ip?: string;
		userAgent?: string;
		now?: number;
	}): Promise<LocalReviewEvidence> {
		const evidence: LocalReviewEvidence = {
			policyVersion: "local-review-v1",
			decision: "pending",
			reason: "local_history_insufficient",
			matureDays: 0,
			manualApproval: false,
			staffInteraction: false,
			matchedHistoryCount: 0,
		};
		if (
			!input.authorName ||
			!input.authorEmail ||
			!input.ip ||
			!input.userAgent
		)
			return evidence;
		const history = await this.db
			.select({
				comment: comments,
				manualApproved: sql<boolean>`${comments.approvalSource} = 'manual' AND ${activeStaff(sql`${comments.approvedByUserId}`, input.siteId)}`,
				staffReplied: sql<boolean>`EXISTS (SELECT 1 FROM comments reply WHERE reply.parent_id = ${comments.id} AND reply.site_id = ${input.siteId} AND reply.status = 'approved' AND reply.deleted_at IS NULL AND reply.author_identity = 'staff' AND ${activeStaff(sql`reply.author_user_id`, input.siteId)})`,
			})
			.from(comments)
			.innerJoin(
				commentRequestMetadata,
				eq(comments.id, commentRequestMetadata.commentId),
			)
			.where(
				and(
					eq(comments.siteId, input.siteId),
					eq(
						comments.authorEmailHash,
						hashCommentEmail(input.authorEmail) ?? "",
					),
					eq(comments.authorName, input.authorName),
					eq(commentRequestMetadata.authorIp, input.ip),
					eq(commentRequestMetadata.authorUserAgent, input.userAgent),
					eq(comments.status, "approved"),
					isNull(comments.deletedAt),
				),
			)
			.orderBy(desc(comments.approvedAt))
			.limit(50);
		const now = input.now ?? Date.now();
		const days = new Set<string>();
		for (const { comment, manualApproved, staffReplied } of history) {
			if (
				!comment.approvedAt ||
				!comment.approvalSource ||
				isNumericComment(comment.contentRaw)
			)
				continue;
			evidence.matchedHistoryCount += 1;
			const ageDays = Math.floor(
				(now - Date.parse(comment.approvedAt)) / 86400000,
			);
			evidence.matureDays = Math.max(evidence.matureDays, ageDays);
			if (ageDays >= 30) days.add(comment.approvedAt.slice(0, 10));
			evidence.manualApproval ||= Boolean(manualApproved);
			evidence.staffInteraction ||= ageDays >= 30 && Boolean(staffReplied);
		}
		if (
			evidence.manualApproval ||
			days.size >= 2 ||
			evidence.staffInteraction
		) {
			evidence.decision = "approved";
			evidence.reason = "local_history_sufficient";
		}
		return evidence;
	}
}
