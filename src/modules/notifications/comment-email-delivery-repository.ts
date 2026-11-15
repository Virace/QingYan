import { randomUUID } from "node:crypto";

import type { DatabaseExecutor } from "../../db/client";
import { taskRuns } from "../../db/schema";
import { TaskEventLogRepository } from "../tasks/task-event-log-repository";
import { TaskRunRepository } from "../tasks/task-run-repository";
import type { TaskActorType, TaskRunStatus } from "../tasks/types";
import {
	type CommentEmailDecisionReason,
	type CommentEmailDeliveryFact,
	type CommentEmailFlow,
	commentEmailDecisionMessage,
} from "./comment-email-delivery-status";

function nowIso(): string {
	return new Date().toISOString();
}

function randomId(prefix: string): string {
	return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function decisionIdempotencyKey(input: {
	flow: CommentEmailFlow;
	commentId: string;
	eventKey: string;
}): string {
	return [
		"notification_email_decision",
		input.flow,
		input.commentId,
		input.eventKey,
	].join(":");
}

export class CommentEmailDeliveryRepository {
	private readonly taskRuns: TaskRunRepository;

	public constructor(private readonly db: DatabaseExecutor) {
		this.taskRuns = new TaskRunRepository(db);
	}

	public async createDecision(input: {
		siteId: number;
		siteKey: string;
		commentId: string;
		flow: CommentEmailFlow;
		eventKey: string;
		status: Extract<TaskRunStatus, "skipped" | "suppressed" | "failed">;
		reasonCode: CommentEmailDecisionReason;
		source: string;
		actorType?: TaskActorType | null;
		actorId?: string | null;
		createdAt?: string;
	}) {
		const timestamp = input.createdAt ?? nowIso();
		const idempotencyKey = decisionIdempotencyKey(input);
		return this.db.transaction(async (tx) => {
			const id = randomId("task");
			const [created] = await tx
				.insert(taskRuns)
				.values({
					id,
					queueBackend: "database",
					type: "notification_email_decision",
					category: "notification",
					status: input.status,
					siteId: input.siteId,
					siteKey: input.siteKey,
					actorType: input.actorType ?? "system",
					actorId: input.actorId ?? "system",
					subjectType: "comment",
					subjectId: input.commentId,
					payloadSummaryJson: JSON.stringify({
						channel: "email",
						flow: input.flow,
						reasonCode: input.reasonCode,
					}),
					payloadJson: JSON.stringify({
						eventKey: input.eventKey,
						source: input.source,
					}),
					errorJson:
						input.status === "failed"
							? JSON.stringify({
									code: "NOTIFICATION_EMAIL_PLANNING_FAILED",
									reasonCode: input.reasonCode,
								})
							: null,
					skipReason:
						input.status === "skipped" || input.status === "suppressed"
							? input.reasonCode
							: null,
					idempotencyKey,
					attempts: 0,
					maxAttempts: 1,
					finishedAt: timestamp,
					createdAt: timestamp,
					updatedAt: timestamp,
				})
				.onConflictDoNothing({ target: taskRuns.idempotencyKey })
				.returning({ id: taskRuns.id });
			const repository = new TaskRunRepository(tx);
			if (!created) {
				const existing = await repository.getByIdempotencyKey(idempotencyKey);
				if (!existing)
					throw new Error("Notification decision conflict row was not found");
				return existing;
			}
			await new TaskEventLogRepository(tx).append({
				taskRunId: id,
				eventType: "notification.email.decision",
				level: input.status === "failed" ? "error" : "info",
				message: commentEmailDecisionMessage(input.reasonCode),
				data: { flow: input.flow, reasonCode: input.reasonCode },
				visibleToSiteAdmin: true,
				createdAt: timestamp,
			});
			return repository.getRequired(id);
		});
	}

	public getDecision(input: {
		commentId: string;
		flow: CommentEmailFlow;
		eventKey: string;
	}) {
		return this.taskRuns.getByIdempotencyKey(decisionIdempotencyKey(input));
	}

	public async listFactsByCommentIds(commentIds: string[]) {
		const uniqueCommentIds = [...new Set(commentIds)];
		const tasks = await this.taskRuns.listNotificationRunsBySubjects({
			subjectType: "comment",
			subjectIds: uniqueCommentIds,
		});
		const deliveries = await this.taskRuns.listDeliveriesForTasks({
			taskRunIds: tasks.map((task) => task.id),
			channel: "email",
		});
		const deliveriesByTaskId = new Map<string, typeof deliveries>();
		for (const delivery of deliveries) {
			const current = deliveriesByTaskId.get(delivery.taskRunId) ?? [];
			current.push(delivery);
			deliveriesByTaskId.set(delivery.taskRunId, current);
		}
		const factsByCommentId = new Map<string, CommentEmailDeliveryFact[]>();
		for (const task of tasks) {
			if (!task.subjectId) {
				continue;
			}
			const current = factsByCommentId.get(task.subjectId) ?? [];
			current.push({
				task,
				deliveries: deliveriesByTaskId.get(task.id) ?? [],
			});
			factsByCommentId.set(task.subjectId, current);
		}
		return factsByCommentId;
	}
}
