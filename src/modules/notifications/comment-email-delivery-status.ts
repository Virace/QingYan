import type { NotificationDeliveryRecord, TaskRunRecord } from "../tasks/types";
import type { NotificationChannelErrorKind } from "./channels/error-classifier";

export type CommentEmailDeliveryState =
	| "accepted"
	| "failed"
	| "processing"
	| "not_sent"
	| "unknown";

export type CommentEmailFlow = "site_staff_comment" | "commenter_reply";

export type CommentEmailDeliveryPhase =
	| "queued"
	| "delayed"
	| "sending"
	| "retrying"
	| "accepted"
	| "failed"
	| "not_sent"
	| "incomplete";

export type CommentEmailDecisionReason =
	| "system_email_unavailable"
	| "site_backend_notifications_disabled"
	| "site_commenter_email_disabled"
	| "comment_event_not_applicable"
	| "no_email_recipients"
	| "recipient_email_disabled"
	| "recipient_email_paused"
	| "comment_not_approved_reply"
	| "commenter_not_visitor"
	| "commenter_email_unavailable"
	| "commenter_not_subscribed"
	| "commenter_unsubscribed"
	| "same_recipient"
	| "email_reputation_suppressed"
	| "source_excluded"
	| "planning_failed"
	| "delivery_missing";

export interface CommentEmailDeliverySummary {
	state: CommentEmailDeliveryState;
	deliveryCount: number;
	acceptedCount: number;
	failedCount: number;
	processingCount: number;
	notSentDecisionCount: number;
	lastUpdatedAt: string | null;
}

export interface CommentEmailDeliveryFact {
	task: TaskRunRecord;
	deliveries: NotificationDeliveryRecord[];
}

export interface CommentEmailDeliveryItem {
	kind: "delivery" | "decision" | "incomplete";
	channel: "email";
	flow: CommentEmailFlow;
	state: Exclude<CommentEmailDeliveryState, "unknown">;
	phase: CommentEmailDeliveryPhase;
	recipient: {
		label: string;
		address: string;
	} | null;
	attemptCount: number;
	maxAttempts: number;
	acceptedAt: string | null;
	updatedAt: string;
	reasonCode: CommentEmailDecisionReason | null;
	errorKind: NotificationChannelErrorKind | null;
	message: string | null;
}

export interface CommentEmailDeliveryGroup {
	flow: CommentEmailFlow;
	label: string;
	state: Exclude<CommentEmailDeliveryState, "unknown">;
	items: CommentEmailDeliveryItem[];
}

export interface CommentEmailDeliveryProjection {
	summary: CommentEmailDeliverySummary;
	groups: CommentEmailDeliveryGroup[];
}

const PROCESSING_TASK_STATUSES = new Set<TaskRunRecord["status"]>([
	"queued",
	"delayed",
	"running",
	"retrying",
]);

const FAILED_TASK_STATUSES = new Set<TaskRunRecord["status"]>([
	"failed",
	"blocked",
	"cancelled",
]);

const FLOW_LABELS: Record<CommentEmailFlow, string> = {
	site_staff_comment: "站点人员评论提醒",
	commenter_reply: "评论者回复提醒",
};

const REASON_MESSAGES: Record<CommentEmailDecisionReason, string> = {
	system_email_unavailable: "邮件服务尚未配置完成。",
	site_backend_notifications_disabled: "当时未开启站点人员邮件通知。",
	site_commenter_email_disabled: "当时未开启评论者回复邮件。",
	comment_event_not_applicable: "这次评论事件不需要发送邮件。",
	no_email_recipients: "当时没有有效的邮件接收人。",
	recipient_email_disabled: "接收人的个人邮件偏好已关闭。",
	recipient_email_paused: "接收人的邮件通知当时处于暂停状态。",
	comment_not_approved_reply: "评论不是可通知的已通过回复。",
	commenter_not_visitor: "原评论者不属于访客邮件通知范围。",
	commenter_email_unavailable: "原评论者没有可用的邮件地址。",
	commenter_not_subscribed: "原评论者没有选择接收回复邮件。",
	commenter_unsubscribed: "原评论者已退订回复邮件。",
	same_recipient: "回复者与收件人相同，因此未发送邮件。",
	email_reputation_suppressed: "该邮箱因投递信誉策略被暂缓发送。",
	source_excluded: "该评论来源不发送邮件通知。",
	planning_failed: "邮件通知规划失败，请查看系统日志。",
	delivery_missing: "通知任务没有生成实际邮件投递。",
};

export function commentEmailDecisionMessage(
	reason: CommentEmailDecisionReason,
): string {
	return REASON_MESSAGES[reason];
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function laterTimestamp(first: string, second: string): string {
	const firstMs = Date.parse(first);
	const secondMs = Date.parse(second);
	if (Number.isFinite(firstMs) && Number.isFinite(secondMs)) {
		return secondMs > firstMs ? second : first;
	}
	return second > first ? second : first;
}

function readDecisionReason(task: TaskRunRecord): CommentEmailDecisionReason {
	const reasonCode = asRecord(task.payloadSummary).reasonCode;
	return typeof reasonCode === "string" && reasonCode in REASON_MESSAGES
		? (reasonCode as CommentEmailDecisionReason)
		: task.status === "failed"
			? "planning_failed"
			: "delivery_missing";
}

function resolveFlow(
	task: TaskRunRecord,
	delivery?: NotificationDeliveryRecord,
): CommentEmailFlow {
	const flow = asRecord(task.payloadSummary).flow;
	if (flow === "site_staff_comment" || flow === "commenter_reply") {
		return flow;
	}
	if (
		delivery?.recipientType === "commenter" ||
		task.type === "reply_approved"
	) {
		return "commenter_reply";
	}
	return "site_staff_comment";
}

function isEmailRelatedFact(fact: CommentEmailDeliveryFact): boolean {
	if (fact.deliveries.some((delivery) => delivery.channel === "email")) {
		return true;
	}
	const summary = asRecord(fact.task.payloadSummary);
	return (
		fact.task.type === "notification_email_decision" ||
		summary.channel === "email" ||
		summary.flow === "site_staff_comment" ||
		summary.flow === "commenter_reply"
	);
}

export function maskEmailAddress(address: string): string {
	const separatorIndex = address.lastIndexOf("@");
	if (separatorIndex <= 0 || separatorIndex === address.length - 1) {
		return "***";
	}
	const localPart = address.slice(0, separatorIndex);
	const domain = address.slice(separatorIndex + 1);
	return `${localPart.slice(0, 1)}***@${domain}`;
}

function recipientLabel(delivery: NotificationDeliveryRecord): string {
	return delivery.recipientType === "commenter" ? "评论者" : "站点人员";
}

function deliveryFailureMessage(delivery: NotificationDeliveryRecord): string {
	const kind = deliveryErrorKind(delivery);
	if (kind === "config" || kind === "provider_auth") {
		return "邮件服务未配置完成或拒绝了本次请求。";
	}
	if (kind === "recipient_permanent") {
		return "收件地址不可用。";
	}
	if (kind === "template") {
		return "邮件模板无法生成。";
	}
	if (kind === "temporary") {
		return "连接邮件服务失败，重试次数已耗尽。";
	}
	return "邮件投递失败，请查看系统日志。";
}

function deliveryErrorKind(
	delivery: NotificationDeliveryRecord,
): NotificationChannelErrorKind | null {
	const kind = asRecord(delivery.lastError).kind;
	return kind === "config" ||
		kind === "temporary" ||
		kind === "recipient_permanent" ||
		kind === "provider_auth" ||
		kind === "template"
		? kind
		: null;
}

function processingPhase(
	status: TaskRunRecord["status"],
): Extract<
	CommentEmailDeliveryPhase,
	"queued" | "delayed" | "sending" | "retrying"
> {
	if (status === "delayed") {
		return "delayed";
	}
	if (status === "running") {
		return "sending";
	}
	if (status === "retrying") {
		return "retrying";
	}
	return "queued";
}

function classifyDelivery(
	task: TaskRunRecord,
	delivery: NotificationDeliveryRecord,
): Pick<
	CommentEmailDeliveryItem,
	"state" | "phase" | "reasonCode" | "errorKind" | "message"
> {
	if (delivery.status === "sent" && delivery.sentAt) {
		return {
			state: "accepted",
			phase: "accepted",
			reasonCode: null,
			errorKind: null,
			message: null,
		};
	}
	if (FAILED_TASK_STATUSES.has(task.status)) {
		return {
			state: "failed",
			phase: "failed",
			reasonCode: null,
			errorKind: deliveryErrorKind(delivery),
			message: deliveryFailureMessage(delivery),
		};
	}
	if (PROCESSING_TASK_STATUSES.has(task.status)) {
		return {
			state: "processing",
			phase: processingPhase(task.status),
			reasonCode: null,
			errorKind: null,
			message: null,
		};
	}
	if (delivery.status === "failed" || delivery.status === "suppressed") {
		return {
			state: "failed",
			phase: "failed",
			reasonCode: null,
			errorKind: deliveryErrorKind(delivery),
			message: deliveryFailureMessage(delivery),
		};
	}
	return {
		state: "failed",
		phase: "incomplete",
		reasonCode: "delivery_missing",
		errorKind: null,
		message: REASON_MESSAGES.delivery_missing,
	};
}

function projectFact(
	fact: CommentEmailDeliveryFact,
): CommentEmailDeliveryItem[] {
	const emailDeliveries = fact.deliveries.filter(
		(delivery) => delivery.channel === "email",
	);
	if (emailDeliveries.length > 0) {
		return emailDeliveries.map((delivery) => {
			const classified = classifyDelivery(fact.task, delivery);
			return {
				kind: "delivery",
				channel: "email",
				flow: resolveFlow(fact.task, delivery),
				state: classified.state,
				phase: classified.phase,
				recipient: {
					label: recipientLabel(delivery),
					address: maskEmailAddress(delivery.recipientAddressSnapshot),
				},
				attemptCount: fact.task.attempts,
				maxAttempts: fact.task.maxAttempts,
				acceptedAt: delivery.sentAt,
				updatedAt: laterTimestamp(fact.task.updatedAt, delivery.updatedAt),
				reasonCode: classified.reasonCode,
				errorKind: classified.errorKind,
				message: classified.message,
			};
		});
	}

	if (fact.task.status === "skipped" || fact.task.status === "suppressed") {
		const reasonCode = readDecisionReason(fact.task);
		return [
			{
				kind: "decision",
				channel: "email",
				flow: resolveFlow(fact.task),
				state: "not_sent",
				phase: "not_sent",
				recipient: null,
				attemptCount: fact.task.attempts,
				maxAttempts: fact.task.maxAttempts,
				acceptedAt: null,
				updatedAt: fact.task.updatedAt,
				reasonCode,
				errorKind: null,
				message: REASON_MESSAGES[reasonCode],
			},
		];
	}

	if (PROCESSING_TASK_STATUSES.has(fact.task.status)) {
		return [
			{
				kind: "incomplete",
				channel: "email",
				flow: resolveFlow(fact.task),
				state: "processing",
				phase: processingPhase(fact.task.status),
				recipient: null,
				attemptCount: fact.task.attempts,
				maxAttempts: fact.task.maxAttempts,
				acceptedAt: null,
				updatedAt: fact.task.updatedAt,
				reasonCode: null,
				errorKind: null,
				message: null,
			},
		];
	}

	const reasonCode = readDecisionReason(fact.task);
	return [
		{
			kind: "incomplete",
			channel: "email",
			flow: resolveFlow(fact.task),
			state: "failed",
			phase: "incomplete",
			recipient: null,
			attemptCount: fact.task.attempts,
			maxAttempts: fact.task.maxAttempts,
			acceptedAt: null,
			updatedAt: fact.task.updatedAt,
			reasonCode,
			errorKind: null,
			message: REASON_MESSAGES[reasonCode],
		},
	];
}

function aggregateState(
	items: CommentEmailDeliveryItem[],
): CommentEmailDeliveryState {
	if (items.some((item) => item.state === "failed")) {
		return "failed";
	}
	if (items.some((item) => item.state === "processing")) {
		return "processing";
	}
	if (items.some((item) => item.state === "accepted")) {
		return "accepted";
	}
	if (items.some((item) => item.state === "not_sent")) {
		return "not_sent";
	}
	return "unknown";
}

export function projectCommentEmailDelivery(
	facts: CommentEmailDeliveryFact[],
): CommentEmailDeliveryProjection {
	const emailFacts = facts.filter(isEmailRelatedFact);
	const items = emailFacts.flatMap(projectFact);
	const lastUpdatedAt = items.reduce<string | null>(
		(latest, item) =>
			latest ? laterTimestamp(latest, item.updatedAt) : item.updatedAt,
		null,
	);
	const summary: CommentEmailDeliverySummary = {
		state: aggregateState(items),
		deliveryCount: emailFacts.reduce(
			(total, fact) =>
				total +
				fact.deliveries.filter((delivery) => delivery.channel === "email")
					.length,
			0,
		),
		acceptedCount: items.filter((item) => item.state === "accepted").length,
		failedCount: items.filter((item) => item.state === "failed").length,
		processingCount: items.filter((item) => item.state === "processing").length,
		notSentDecisionCount: items.filter(
			(item) => item.kind === "decision" && item.state === "not_sent",
		).length,
		lastUpdatedAt,
	};
	const groups = (["site_staff_comment", "commenter_reply"] as const).flatMap(
		(flow) => {
			const flowItems = items.filter((item) => item.flow === flow);
			return flowItems.length > 0
				? [
						{
							flow,
							label: FLOW_LABELS[flow],
							state: aggregateState(flowItems) as Exclude<
								CommentEmailDeliveryState,
								"unknown"
							>,
							items: flowItems,
						},
					]
				: [];
		},
	);
	return { summary, groups };
}
