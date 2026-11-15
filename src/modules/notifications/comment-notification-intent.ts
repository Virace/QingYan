import type { DatabaseExecutor } from "../../db/client";
import type { TaskActorType } from "../tasks/types";
import { TaskRunRepository } from "../tasks/task-run-repository";
import {
	BackendUserNotificationPlanner,
	type BackendUserNotificationEvent,
} from "./backend-user-notification-planner";
import { CommentNotificationPlanner } from "./comment-notification-planner";
import { captureCommentEventSnapshot } from "./comment-event-snapshot";

export interface CommentNotificationIntent
	extends BackendUserNotificationEvent {
	actorType?: TaskActorType | null;
	actorId?: string | null;
	notifyBackend: boolean;
	notifyReply: boolean;
}

export async function enqueueCommentNotificationIntent(
	db: DatabaseExecutor,
	input: CommentNotificationIntent,
) {
	if (input.status !== "approved" && input.status !== "pending") return null;
	if (input.source === "import" || input.source === "migration") return null;
	if (!input.notifyBackend && !input.notifyReply) return null;
	const snapshot = await captureCommentEventSnapshot(db, input.commentId);
	return new TaskRunRepository(db).create({
		type: "comment_notification_intent",
		category: "notification",
		siteId: input.siteId,
		siteKey: input.siteKey,
		subjectType: "comment",
		subjectId: input.commentId,
		actorType: input.actorType ?? "system",
		actorId: input.actorId ?? null,
		idempotencyKey: `comment_notification_intent:${input.commentId}:${input.source}:${input.previousStatus ?? "new"}:${input.status}`,
		payloadSummary: {
			channel: "email",
			flow: input.notifyBackend ? "site_staff_comment" : "commenter_reply",
		},
		payload: { ...input, commentSnapshot: snapshot },
		maxAttempts: 5,
		retryDelaySec: 15,
	});
}

export function processCommentNotificationIntent(
	db: DatabaseExecutor,
	input: CommentNotificationIntent,
) {
	return db.transaction(async (tx) => {
		if (input.notifyBackend)
			await new BackendUserNotificationPlanner(tx).planForCommentEvent(input);
		if (input.notifyReply && input.status === "approved")
			await new CommentNotificationPlanner(tx).planForCommentEvent(input);
	});
}
