import type {
	CommentEmailDeliveryItem,
	CommentEmailDeliverySummary,
	CommentEmailDeliveryState,
} from "../../../api/email-delivery";

export type EmailDeliveryTone =
	| "success"
	| "danger"
	| "warning"
	| "muted"
	| "unknown";

export type EmailDeliveryRecoveryTarget = "system_mail" | "site_notifications";

export interface EmailDeliveryStatePresentation {
	label: string;
	accessibleLabel: string;
	tone: EmailDeliveryTone;
}

export const MAX_EMAIL_DELIVERY_POLL_COUNT = 30;

function stateLabel(state: CommentEmailDeliveryState): string {
	if (state === "accepted") {
		return "邮件服务商已接受";
	}
	if (state === "failed") {
		return "邮件投递失败";
	}
	if (state === "processing") {
		return "邮件处理中";
	}
	if (state === "not_sent") {
		return "邮件未发送";
	}
	return "无历史投递记录";
}

export function emailDeliveryStatePresentation(
	summary: CommentEmailDeliverySummary,
): EmailDeliveryStatePresentation {
	if (summary.state === "accepted") {
		return {
			label: stateLabel(summary.state),
			accessibleLabel: `邮件：服务商已接受，${summary.acceptedCount}/${summary.deliveryCount}`,
			tone: "success",
		};
	}
	if (summary.state === "failed") {
		const isPartial = summary.acceptedCount > 0;
		return {
			label: isPartial ? "邮件部分失败" : stateLabel(summary.state),
			accessibleLabel: isPartial
				? `邮件：部分失败，已接受 ${summary.acceptedCount}，失败 ${summary.failedCount}`
				: `邮件：投递失败，${summary.failedCount} 项`,
			tone: "danger",
		};
	}
	if (summary.state === "processing") {
		return {
			label: stateLabel(summary.state),
			accessibleLabel: `邮件：处理中，${summary.processingCount} 项`,
			tone: "warning",
		};
	}
	if (summary.state === "not_sent") {
		return {
			label: stateLabel(summary.state),
			accessibleLabel: `邮件：未发送，${summary.notSentDecisionCount} 项决定`,
			tone: "muted",
		};
	}
	return {
		label: stateLabel(summary.state),
		accessibleLabel: "邮件：无历史投递记录",
		tone: "unknown",
	};
}

export function emailDeliverySummaryText(
	summary: CommentEmailDeliverySummary,
): string {
	if (summary.state === "accepted") {
		return `${summary.acceptedCount}/${summary.deliveryCount} 项实际投递已被邮件服务商接受。`;
	}
	if (summary.state === "failed") {
		return summary.acceptedCount > 0
			? `${summary.acceptedCount} 项已接受，${summary.failedCount} 项失败。`
			: `${summary.failedCount} 项投递或规划失败。`;
	}
	if (summary.state === "processing") {
		return `${summary.processingCount} 项仍在排队、发送或重试。`;
	}
	if (summary.state === "not_sent") {
		return `${summary.notSentDecisionCount} 项流程有明确的未发送决定。`;
	}
	return "没有足够的历史记录判断这条评论是否发送过邮件。";
}

export function emailDeliveryPhaseLabel(
	item: CommentEmailDeliveryItem,
): string {
	if (item.phase === "queued") {
		return "排队中";
	}
	if (item.phase === "delayed") {
		return "等待摘要发送";
	}
	if (item.phase === "sending") {
		return "正在发送";
	}
	if (item.phase === "retrying") {
		return `正在重试（已尝试 ${item.attemptCount}/${item.maxAttempts} 次）`;
	}
	if (item.phase === "accepted") {
		return "邮件服务商已接受";
	}
	if (item.phase === "failed") {
		return "邮件投递失败";
	}
	if (item.phase === "not_sent") {
		return "邮件未发送";
	}
	return "投递记录不完整";
}

export function emailDeliveryRecoveryTarget(
	item: CommentEmailDeliveryItem,
): EmailDeliveryRecoveryTarget | null {
	if (
		item.reasonCode === "system_email_unavailable" ||
		item.errorKind === "config" ||
		item.errorKind === "provider_auth"
	) {
		return "system_mail";
	}
	if (
		item.reasonCode === "site_backend_notifications_disabled" ||
		item.reasonCode === "site_commenter_email_disabled" ||
		item.reasonCode === "no_email_recipients"
	) {
		return "site_notifications";
	}
	return null;
}

export function shouldPollEmailDelivery(
	summary: CommentEmailDeliverySummary | undefined,
	pollCount: number,
	isPageVisible: boolean,
): boolean {
	return (
		isPageVisible &&
		summary?.state === "processing" &&
		pollCount < MAX_EMAIL_DELIVERY_POLL_COUNT
	);
}
