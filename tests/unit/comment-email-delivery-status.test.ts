import { describe, expect, it } from "vitest";

import {
	projectCommentEmailDelivery,
	type CommentEmailDeliveryFact,
} from "../../src/modules/notifications/comment-email-delivery-status";
import type {
	NotificationDeliveryRecord,
	TaskRunRecord,
} from "../../src/modules/tasks/types";

const NOW = "2026-08-19T10:00:00.000Z";

function task(
	status: TaskRunRecord["status"],
	overrides: Partial<TaskRunRecord> = {},
): TaskRunRecord {
	return {
		id: "task_1",
		queueBackend: "database",
		queueMessageId: null,
		scheduledTaskId: null,
		scheduledTaskNameSnapshot: null,
		type: "backend_user_comment_approved",
		category: "notification",
		status,
		siteId: 1,
		siteKey: "fangyuan",
		scopeKind: null,
		scope: null,
		trigger: null,
		triggerSnapshot: null,
		input: null,
		actionConfigSnapshot: null,
		actorType: "system",
		actorId: "system",
		subjectType: "comment",
		subjectId: "comment_1",
		payloadSummary: { channel: "email", flow: "site_staff_comment" },
		payload: {},
		progress: null,
		result: null,
		error: null,
		idempotencyKey: null,
		runAfter: null,
		attempts: 1,
		maxAttempts: 3,
		retryDelaySec: 0,
		priority: 0,
		concurrencyKey: null,
		workerId: null,
		lockConflictWithRunId: null,
		lockConflictWithTaskName: null,
		ownerUserIdSnapshot: null,
		createdByUserId: null,
		skipReason: null,
		blockReason: null,
		createdAt: NOW,
		startedAt: null,
		finishedAt: status === "succeeded" ? NOW : null,
		updatedAt: NOW,
		...overrides,
	};
}

function delivery(
	status: string,
	overrides: Partial<NotificationDeliveryRecord> = {},
): NotificationDeliveryRecord {
	return {
		id: "delivery_1",
		taskRunId: "task_1",
		channel: "email",
		channelConfigRef: "email:default",
		channelConfigNameSnapshot: "默认邮件",
		recipientType: "backend_user",
		recipientUserId: 1,
		recipientAddressSnapshot: "admin@example.test",
		recipientIdentityKey: "backend_user:1:email:default",
		eventFamily: "admin_comment_approved",
		templateKey: "backend_user.comment.approved",
		status,
		providerMessageId: null,
		lastError: null,
		sentAt: status === "sent" ? NOW : null,
		updatedAt: NOW,
		...overrides,
	};
}

function fact(
	status: TaskRunRecord["status"],
	deliveries: NotificationDeliveryRecord[],
	overrides: Partial<TaskRunRecord> = {},
): CommentEmailDeliveryFact {
	return { task: task(status, overrides), deliveries };
}

describe("comment email delivery status", () => {
	it("aggregates one or many accepted deliveries", () => {
		const projection = projectCommentEmailDelivery([
			fact("succeeded", [
				delivery("sent"),
				delivery("sent", { id: "delivery_2" }),
			]),
		]);

		expect(projection.summary).toMatchObject({
			state: "accepted",
			deliveryCount: 2,
			acceptedCount: 2,
			failedCount: 0,
		});
		expect(projection.groups[0]?.items[0]?.recipient).toEqual({
			label: "站点人员",
			address: "a***@example.test",
		});
		expect(projection.groups[0]?.items[0]).toMatchObject({
			channel: "email",
			phase: "accepted",
			attemptCount: 1,
		});
	});

	it("reports partial failure when an accepted delivery has a failed peer", () => {
		const projection = projectCommentEmailDelivery([
			fact("failed", [
				delivery("sent"),
				delivery("failed", {
					id: "delivery_2",
					sentAt: null,
					lastError: { kind: "recipient_permanent", message: "secret" },
				}),
			]),
		]);

		expect(projection.summary).toMatchObject({
			state: "failed",
			acceptedCount: 1,
			failedCount: 1,
		});
		expect(projection.groups[0]?.items[1]).toMatchObject({
			phase: "failed",
			errorKind: "recipient_permanent",
		});
		expect(JSON.stringify(projection)).not.toContain("secret");
	});

	it("keeps accepted plus retrying work in processing", () => {
		const projection = projectCommentEmailDelivery([
			fact("retrying", [
				delivery("sent"),
				delivery("failed", { id: "delivery_2", sentAt: null }),
			]),
		]);

		expect(projection.summary).toMatchObject({
			state: "processing",
			acceptedCount: 1,
			processingCount: 1,
		});
		expect(projection.groups[0]?.items[1]?.phase).toBe("retrying");
	});

	it("aggregates explicit decisions without actual deliveries as not sent", () => {
		const projection = projectCommentEmailDelivery([
			fact("skipped", [], {
				type: "notification_email_decision",
				payloadSummary: {
					channel: "email",
					flow: "site_staff_comment",
					reasonCode: "site_backend_notifications_disabled",
				},
			}),
			fact("suppressed", [], {
				id: "task_2",
				type: "notification_email_decision",
				payloadSummary: {
					channel: "email",
					flow: "commenter_reply",
					reasonCode: "email_reputation_suppressed",
				},
			}),
		]);

		expect(projection.summary).toMatchObject({
			state: "not_sent",
			deliveryCount: 0,
			notSentDecisionCount: 2,
		});
	});

	it("does not let a not-sent flow downgrade an accepted delivery", () => {
		const projection = projectCommentEmailDelivery([
			fact("succeeded", [delivery("sent")]),
			fact("skipped", [], {
				id: "task_2",
				type: "notification_email_decision",
				payloadSummary: {
					channel: "email",
					flow: "commenter_reply",
					reasonCode: "commenter_not_subscribed",
				},
			}),
		]);

		expect(projection.summary.state).toBe("accepted");
	});

	it("returns unknown when no persisted email fact exists", () => {
		expect(projectCommentEmailDelivery([]).summary).toEqual({
			state: "unknown",
			deliveryCount: 0,
			acceptedCount: 0,
			failedCount: 0,
			processingCount: 0,
			notSentDecisionCount: 0,
			lastUpdatedAt: null,
		});
	});

	it("lets a terminal parent failure override a queued delivery", () => {
		const projection = projectCommentEmailDelivery([
			fact("failed", [delivery("queued")]),
		]);

		expect(projection.summary).toMatchObject({
			state: "failed",
			failedCount: 1,
			processingCount: 0,
		});
	});

	it("keeps a failed delivery red when a legacy parent was marked succeeded", () => {
		const projection = projectCommentEmailDelivery([
			fact("succeeded", [
				delivery("failed", {
					lastError: { kind: "temporary", message: "private response" },
				}),
			]),
		]);

		expect(projection.summary.state).toBe("failed");
		expect(projection.groups[0]?.items[0]).toMatchObject({
			phase: "failed",
			errorKind: "temporary",
		});
		expect(JSON.stringify(projection)).not.toContain("private response");
	});

	it("treats a succeeded email task without a delivery as incomplete failure", () => {
		const projection = projectCommentEmailDelivery([fact("succeeded", [])]);

		expect(projection.summary).toMatchObject({
			state: "failed",
			deliveryCount: 0,
			failedCount: 1,
		});
		expect(projection.groups[0]?.items[0]).toMatchObject({
			kind: "incomplete",
			reasonCode: "delivery_missing",
		});
	});

	it("keeps a delayed digest without deliveries in processing", () => {
		const projection = projectCommentEmailDelivery([
			fact("delayed", [], {
				type: "backend_user_comment_digest",
				runAfter: "2026-08-20T10:00:00.000Z",
			}),
		]);

		expect(projection.summary).toMatchObject({
			state: "processing",
			processingCount: 1,
		});
		expect(projection.groups[0]?.items[0]?.phase).toBe("delayed");
	});

	it("ignores notification facts that only belong to non-email channels", () => {
		const projection = projectCommentEmailDelivery([
			fact(
				"succeeded",
				[
					delivery("sent", {
						channel: "webhook",
						recipientType: "external_target",
					}),
				],
				{
					payloadSummary: { channel: "webhook" },
				},
			),
		]);

		expect(projection.summary.state).toBe("unknown");
	});
});
