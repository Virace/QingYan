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
import { EmailReputationRepository } from "./email-reputation-repository";
import {
	hashNotificationEmail,
	isAcceptableNotificationEmail,
	normalizeNotificationEmail,
} from "./email-address-policy";

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

	public constructor(private readonly db: AppDatabase) {
		this.taskRuns = new TaskRunRepository(db);
		this.reputation = new EmailReputationRepository(db);
	}

	public async planForCommentEvent(
		input: CommentNotificationPlanInput,
	): Promise<CommentNotificationPlanResult> {
		if (input.source === "import" || input.source === "migration") {
			return { createdCount: 0, taskIds: [] };
		}
		if (!(await this.isCommenterReplyEmailAvailable(input.siteId))) {
			return { createdCount: 0, taskIds: [] };
		}

		const context = await this.loadReplyContext(input.commentId);
		if (
			!context ||
			context.reply.status !== "approved" ||
			!context.reply.parentId
		) {
			return { createdCount: 0, taskIds: [] };
		}
		if (context.reply.siteId !== input.siteId) {
			return { createdCount: 0, taskIds: [] };
		}
		if (
			context.parent.authorUserId !== null ||
			context.parent.authorIdentity !== "visitor"
		) {
			return { createdCount: 0, taskIds: [] };
		}
		if (!isAcceptableNotificationEmail(context.parent.authorEmail)) {
			return { createdCount: 0, taskIds: [] };
		}

		const parentEmail = normalizeNotificationEmail(context.parent.authorEmail);
		const parentEmailHash = hashNotificationEmail(parentEmail);
		if (!parentEmailHash) {
			return { createdCount: 0, taskIds: [] };
		}
		const replyEmail = normalizeNotificationEmail(context.reply.authorEmail);
		if (replyEmail && replyEmail === parentEmail) {
			return { createdCount: 0, taskIds: [] };
		}

		const preference = await this.loadPreference(input.siteId, parentEmailHash);
		if (!preference?.notifyOnReply || preference.unsubscribedAt !== null) {
			return { createdCount: 0, taskIds: [] };
		}
		if (
			await this.reputation.isSuppressed({
				siteId: input.siteId,
				email: parentEmail,
			})
		) {
			return { createdCount: 0, taskIds: [] };
		}

		const idempotencyKey = `commenter:reply_approved:${input.commentId}:email:${parentEmailHash}`;
		const existing = await this.taskRuns.getByIdempotencyKey(idempotencyKey);
		const task = await this.taskRuns.create({
			type: "reply_approved",
			category: "notification",
			siteId: input.siteId,
			siteKey: input.siteKey,
			actorType: input.actorType ?? null,
			actorId: input.actorId ?? null,
			subjectType: "comment",
			subjectId: input.commentId,
			payloadSummary: {
				channel: "email",
				recipientType: "commenter",
				recipientAddressSnapshot: parentEmail,
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
		});
		if (!existing) {
			await this.taskRuns.createDelivery({
				taskRunId: task.id,
				channel: "email",
				recipientType: "commenter",
				recipientAddressSnapshot: parentEmail,
				recipientIdentityKey: parentEmailHash,
				eventFamily: "reply_approved",
				templateKey: "commenter.reply_approved",
			});
		}

		return { createdCount: existing ? 0 : 1, taskIds: [task.id] };
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
		if (!row.reply.parentId) {
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

	private async isCommenterReplyEmailAvailable(siteId: number) {
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
		return (
			Boolean(settings?.commenterReplyEmailEnabled) &&
			isSystemMailUsable(systemSettings.mail)
		);
	}
}
