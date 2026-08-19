import { and, eq, isNull } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	commenterNotificationPreferences,
	comments,
	pageThreads,
	siteSettings,
} from "../../db/schema";
import { isSystemMailUsable } from "../comments/public-contract";
import { RuntimeSystemSettingsService } from "../system-settings/service";
import { TaskRunRepository } from "../tasks/task-run-repository";
import type { TaskActorType } from "../tasks/types";
import type { NotificationChannelFilter } from "./backend-user-notification-planner";
import {
	hashNotificationEmail,
	isAcceptableNotificationEmail,
	normalizeNotificationEmail,
} from "./email-address-policy";
import { EmailReputationRepository } from "./email-reputation-repository";
import { CommentEmailDeliveryRepository } from "./comment-email-delivery-repository";
import type { CommentEmailDecisionReason } from "./comment-email-delivery-status";

export type CommentNotificationSource =
	| "public_api"
	| "admin_reply"
	| "admin_moderation"
	| "akismet"
	| "import"
	| "migration"
	| "system";

export interface CommentNotificationPlanInput {
	siteId: number;
	siteKey: string;
	pageKey: string;
	commentId: string;
	source: CommentNotificationSource;
	actorType?: TaskActorType | null;
	actorId?: string | null;
}

export interface CommentNotificationPlanResult {
	createdCount: number;
	taskIds: string[];
}

export class CommentNotificationPlanner {
	private readonly taskRuns: TaskRunRepository;
	private readonly reputation: EmailReputationRepository;
	private readonly emailDelivery: CommentEmailDeliveryRepository;

	public constructor(private readonly db: AppDatabase) {
		this.taskRuns = new TaskRunRepository(db);
		this.reputation = new EmailReputationRepository(db);
		this.emailDelivery = new CommentEmailDeliveryRepository(db);
	}

	public async planForCommentEvent(
		input: CommentNotificationPlanInput,
		options: {
			channelFilter?: NotificationChannelFilter;
		} = {},
	): Promise<CommentNotificationPlanResult> {
		if (options.channelFilter && !options.channelFilter.includes("email")) {
			return { createdCount: 0, taskIds: [] };
		}
		try {
			return await this.planEmail(input);
		} catch (error) {
			await this.recordDecision(input, "planning_failed", "failed").catch(
				() => undefined,
			);
			throw error;
		}
	}

	private async planEmail(
		input: CommentNotificationPlanInput,
	): Promise<CommentNotificationPlanResult> {
		if (
			await this.emailDelivery.getDecision({
				commentId: input.commentId,
				flow: "commenter_reply",
				eventKey: `${input.source}:reply`,
			})
		) {
			return { createdCount: 0, taskIds: [] };
		}
		if (input.source === "import" || input.source === "migration") {
			return this.skip(input, "source_excluded");
		}
		const availability = await this.commenterReplyEmailAvailability(
			input.siteId,
		);
		if (!availability.siteEnabled) {
			return this.skip(input, "site_commenter_email_disabled");
		}
		if (!availability.systemMailUsable) {
			return this.skip(input, "system_email_unavailable");
		}

		const context = await this.loadReplyContext(input.commentId);
		if (context?.reply.status !== "approved" || !context.reply.parentId) {
			return this.skip(input, "comment_not_approved_reply");
		}
		if (context.reply.siteId !== input.siteId) {
			return this.skip(input, "planning_failed", "failed");
		}
		if (
			context.parent.authorUserId !== null ||
			context.parent.authorIdentity !== "visitor"
		) {
			return this.skip(input, "commenter_not_visitor");
		}
		if (!isAcceptableNotificationEmail(context.parent.authorEmail)) {
			return this.skip(input, "commenter_email_unavailable");
		}

		const parentEmail = normalizeNotificationEmail(context.parent.authorEmail);
		const parentEmailHash = hashNotificationEmail(parentEmail);
		if (!parentEmailHash) {
			return this.skip(input, "commenter_email_unavailable");
		}
		const replyEmail = normalizeNotificationEmail(context.reply.authorEmail);
		if (replyEmail && replyEmail === parentEmail) {
			return this.skip(input, "same_recipient");
		}

		const preference = await this.loadPreference(input.siteId, parentEmailHash);
		if (preference?.unsubscribedAt) {
			return this.skip(input, "commenter_unsubscribed", "suppressed");
		}
		if (!preference?.notifyOnReply) {
			return this.skip(input, "commenter_not_subscribed");
		}
		if (
			await this.reputation.isSuppressed({
				siteId: input.siteId,
				email: parentEmail,
			})
		) {
			return this.skip(input, "email_reputation_suppressed", "suppressed");
		}

		const idempotencyKey = `commenter:reply_approved:${input.commentId}:email:${parentEmailHash}`;
		const created = await this.taskRuns.createNotificationTaskWithDelivery({
			task: {
				type: "reply_approved",
				siteId: input.siteId,
				siteKey: input.siteKey,
				actorType: input.actorType ?? null,
				actorId: input.actorId ?? null,
				subjectType: "comment",
				subjectId: input.commentId,
				payloadSummary: {
					channel: "email",
					flow: "commenter_reply",
					recipientType: "commenter",
				},
				payload: {
					event: "reply_approved",
					source: input.source,
					siteId: input.siteId,
					siteKey: input.siteKey,
					pageKey: input.pageKey,
					pageTitle: context.thread.pageTitle,
					pageUrl: context.thread.pageUrl,
					parentCommentId: context.parent.id,
					replyCommentId: context.reply.id,
					recipient: {
						type: "commenter",
						emailHash: parentEmailHash,
					},
				},
				idempotencyKey,
				maxAttempts: 3,
			},
			delivery: {
				channel: "email",
				recipientType: "commenter",
				recipientAddressSnapshot: parentEmail,
				recipientIdentityKey: parentEmailHash,
				eventFamily: "reply_approved",
				templateKey: "commenter.reply_approved",
			},
		});

		return {
			createdCount: created.created ? 1 : 0,
			taskIds: [created.task.id],
		};
	}

	private async skip(
		input: CommentNotificationPlanInput,
		reasonCode: CommentEmailDecisionReason,
		status: "skipped" | "suppressed" | "failed" = "skipped",
	): Promise<CommentNotificationPlanResult> {
		await this.recordDecision(input, reasonCode, status);
		return { createdCount: 0, taskIds: [] };
	}

	private recordDecision(
		input: CommentNotificationPlanInput,
		reasonCode: CommentEmailDecisionReason,
		status: "skipped" | "suppressed" | "failed",
	) {
		return this.emailDelivery.createDecision({
			siteId: input.siteId,
			siteKey: input.siteKey,
			commentId: input.commentId,
			flow: "commenter_reply",
			eventKey: `${input.source}:reply`,
			status,
			reasonCode,
			source: input.source,
			actorType: input.actorType ?? null,
			actorId: input.actorId ?? null,
		});
	}

	private async loadReplyContext(commentId: string) {
		const [row] = await this.db
			.select({
				reply: comments,
				parent: {
					id: comments.id,
				},
			})
			.from(comments)
			.where(eq(comments.id, commentId))
			.limit(1);
		if (!row?.reply.parentId) {
			return null;
		}

		const [parent] = await this.db
			.select()
			.from(comments)
			.where(
				and(eq(comments.id, row.reply.parentId), isNull(comments.deletedAt)),
			)
			.limit(1);
		const [thread] = await this.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.id, row.reply.pageThreadId))
			.limit(1);
		if (!parent || !thread) {
			return null;
		}

		return {
			reply: row.reply,
			parent,
			thread,
		};
	}

	private async loadPreference(siteId: number, emailHash: string) {
		const [row] = await this.db
			.select()
			.from(commenterNotificationPreferences)
			.where(
				and(
					eq(commenterNotificationPreferences.siteId, siteId),
					eq(commenterNotificationPreferences.emailHash, emailHash),
				),
			)
			.limit(1);
		return row ?? null;
	}

	private async commenterReplyEmailAvailability(siteId: number) {
		const [[settings], systemSettings] = await Promise.all([
			this.db
				.select({
					commenterReplyEmailEnabled: siteSettings.commenterReplyEmailEnabled,
				})
				.from(siteSettings)
				.where(eq(siteSettings.siteId, siteId))
				.limit(1),
			new RuntimeSystemSettingsService(this.db).getSettings(),
		]);
		return {
			siteEnabled: Boolean(settings?.commenterReplyEmailEnabled),
			systemMailUsable: isSystemMailUsable(systemSettings.mail),
		};
	}
}
