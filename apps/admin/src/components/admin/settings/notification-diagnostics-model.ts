import type {
	NotificationChainTestResult,
	NotificationChainTestStatus,
	NotificationDiagnostic,
	NotificationDiagnosticFlowKey,
	NotificationDiagnosticIssue,
	NotificationDiagnosticStatus,
} from "../../../api/admin";

export type NotificationStatusBadge = {
	label: string;
	variant: "secondary" | "outline" | "destructive";
};

type DiagnosticIssueContext = {
	flowKey: NotificationDiagnosticFlowKey;
	siteKey: string;
};

const diagnosticFlowTitles: Record<NotificationDiagnosticFlowKey, string> = {
	admin_comment_pending_email: "待审核评论通知",
	admin_comment_approved_email: "直接发布评论通知",
	commenter_reply_email: "评论回复通知",
};

const diagnosticFlowDescriptions: Record<
	NotificationDiagnosticFlowKey,
	string
> = {
	admin_comment_pending_email: "新评论进入审核时，向站点人员发送邮件",
	admin_comment_approved_email: "评论直接发布时，向站点人员发送邮件",
	commenter_reply_email: "站点人员回复评论时，向原评论者发送邮件",
};

const diagnosticRecipientEmptyText: Record<
	NotificationDiagnosticFlowKey,
	string
> = {
	admin_comment_pending_email: "还没有可接收这类邮件的站点人员",
	admin_comment_approved_email: "还没有可接收这类邮件的站点人员",
	commenter_reply_email: "收件人将在评论者订阅回复提醒后确定",
};

const commenterDeliveryConditionCodes = new Set([
	"reply_email_default_unchecked",
	"commenter_email_required",
	"commenter_opt_in_required",
	"commenter_unsubscribe_check_required",
	"commenter_reputation_check_required",
	"reply_actor_identity_check_required",
]);

export function notificationStatusBadge(
	status: NotificationDiagnosticStatus | NotificationChainTestStatus,
): NotificationStatusBadge {
	switch (status) {
		case "ready":
			return { label: "可以发送", variant: "secondary" };
		case "conditional":
			return { label: "发送时确认", variant: "outline" };
		case "blocked":
			return { label: "需要设置", variant: "destructive" };
		case "checking":
			return { label: "检查中", variant: "outline" };
		case "queued":
			return { label: "等待发送", variant: "outline" };
		case "running":
			return { label: "发送中", variant: "outline" };
		case "passed":
			return { label: "已通过", variant: "secondary" };
		case "failed":
			return { label: "发送失败", variant: "destructive" };
		case "timed_out":
			return { label: "已超时", variant: "destructive" };
	}
}

function recipientLabel(recipient: {
	displayName?: string;
	email: string;
}): string {
	return recipient.displayName
		? `${recipient.displayName}（${recipient.email}）`
		: recipient.email;
}

function siteLabel(siteKey: string): string {
	return siteKey.trim() ? `“${siteKey.trim()}”站点` : "当前站点";
}

function adminEventLabel(flowKey: NotificationDiagnosticFlowKey): string {
	return flowKey === "admin_comment_pending_email" ? "待审核评论" : "评论通过";
}

function diagnosticIssueText(
	issue: NotificationDiagnosticIssue,
	context: DiagnosticIssueContext,
): string {
	const currentSite = siteLabel(context.siteKey);
	const backendNotificationLocation = `${currentSite}的“后台用户通知”`;

	if (commenterDeliveryConditionCodes.has(issue.code)) {
		return "评论者填写有效邮箱并勾选“有人回复时邮件通知我”后，系统才会发送回复提醒。";
	}

	switch (issue.code) {
		case "system_mail_disabled":
		case "mail_disabled":
			return "请到“系统设置 > 系统邮件”开启系统邮件，然后保存设置。";
		case "smtp_host_missing":
			return "请到“系统设置 > 系统邮件”填写邮件服务器地址，然后保存设置。";
		case "smtp_from_missing":
			return "请到“系统设置 > 系统邮件”填写发件人地址，然后保存设置。";
		case "queue_backend_unavailable":
		case "notification_worker_not_started":
		case "notification_worker_no_tick":
			return "邮件发送服务尚未正常运行，请联系系统管理员检查服务状态。";
		case "notification_worker_last_error":
			return "邮件发送服务最近出现异常，建议联系系统管理员确认后再测试。";
		case "backend_notifications_disabled":
			return `请在${backendNotificationLocation}中开启“启用后台用户通知”，然后保存设置。`;
		case "no_enabled_backend_recipient":
			return `请在${backendNotificationLocation}中添加并启用至少一名接收人，然后保存设置。`;
		case "recipient_user_inactive":
			return `请在${backendNotificationLocation}中更换为已启用的后台用户，然后保存设置。`;
		case "recipient_site_access_missing":
			return `请先为对应接收人开通${currentSite}的访问权限，或在“后台用户通知”中更换接收人。`;
		case "email_event_route_missing":
		case "email_event_route_disabled":
			return `请在${backendNotificationLocation}中编辑对应接收人，为“${adminEventLabel(context.flowKey)}”添加邮件通知，然后保存设置。`;
		case "email_channel_config_missing":
		case "email_channel_config_disabled":
			return `请在${backendNotificationLocation}中编辑对应接收人，重新选择可用的邮件通知方式，然后保存设置。`;
		case "recipient_email_preference_disabled":
		case "recipient_email_preference_paused":
			return "请联系对应接收人开启个人邮件通知，或在“后台用户通知”中更换接收人。";
		case "recipient_email_digest_delayed":
			return "对应接收人启用了邮件汇总，这封邮件会稍后发送。";
		case "comments_disabled":
			return "请到当前站点的“评论”页签开启评论功能，然后保存设置。";
		case "comment_replies_disabled":
			return "请到当前站点的“评论”页签，把“评论最大层级”设为 2 或以上，然后保存设置。";
		case "commenter_reply_email_disabled":
			return "请在上方“评论者回复邮件通知”中开启“允许评论者订阅回复邮件”，然后保存设置。";
		case "commenter_email_invalid":
			return "请输入有效的评论者邮箱后再测试。";
		case "commenter_unsubscribed":
			return "这名评论者已取消回复提醒，请换一个已订阅的邮箱进行测试。";
		case "commenter_email_suppressed":
			return "这名评论者的邮箱暂时无法接收通知，请换一个邮箱测试，或联系系统管理员恢复发送。";
		case "recent_email_delivery_failed":
			return "最近一次发送未成功，完成当前设置后请再发送一次测试邮件。";
		case "recent_email_delivery_sent":
			return "最近一次邮件已交给邮件服务商，请到收件箱确认是否收到。";
		case "recent_chain_test_failed":
			return "最近一次邮件测试未通过，完成当前设置后请重新测试。";
		case "recent_chain_test_passed":
			return "最近一次邮件测试已通过。";
		default:
			return "当前设置还不能发送这类邮件，请按页面中的通知设置逐项检查，或联系系统管理员。";
	}
}

function uniqueIssueMessages(
	issues: NotificationDiagnosticIssue[],
	context: DiagnosticIssueContext,
): string[] {
	return [
		...new Set(issues.map((issue) => diagnosticIssueText(issue, context))),
	];
}

export function diagnosticFlowRows(
	diagnostic: NotificationDiagnostic,
	siteKey: string,
) {
	return diagnostic.flows.map((flow) => {
		const context = { flowKey: flow.key, siteKey };
		return {
			key: flow.key,
			title: diagnosticFlowTitles[flow.key],
			description: diagnosticFlowDescriptions[flow.key],
			badge: notificationStatusBadge(flow.status),
			blockerMessages: uniqueIssueMessages(flow.blockers, context),
			warningMessages: uniqueIssueMessages(flow.warnings, context),
			recipients: flow.recipients.map(recipientLabel),
			recipientEmptyText: diagnosticRecipientEmptyText[flow.key],
		};
	});
}

export function notificationChainTestBlockers(
	diagnostic: NotificationDiagnostic,
	defaultCommentStatus: "pending" | "approved",
): NotificationDiagnosticIssue[] {
	const adminFlowKey =
		defaultCommentStatus === "pending"
			? "admin_comment_pending_email"
			: "admin_comment_approved_email";
	const selectedKeys: NotificationDiagnosticFlowKey[] = [
		adminFlowKey,
		"commenter_reply_email",
	];

	const seen = new Set<string>();
	return diagnostic.flows
		.filter((flow) => selectedKeys.includes(flow.key))
		.flatMap((flow) => flow.blockers)
		.filter((blocker) => {
			const key = `${blocker.code}:${blocker.path ?? ""}`;
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		});
}

export function notificationChainTestPollInterval(
	status?: NotificationChainTestStatus,
): 1500 | false {
	return status === "checking" || status === "queued" || status === "running"
		? 1500
		: false;
}

function chainSummary(
	status: NotificationChainTestStatus,
	providerAccepted: boolean,
): string {
	if (providerAccepted) {
		return "两类测试邮件均已被邮件服务商接受；这不等于已经进入收件箱，请继续核对两个收件箱。";
	}
	if (status === "timed_out") {
		return "测试等待时间过长。请稍后重试；如果仍未完成，请联系系统管理员检查邮件发送服务。";
	}
	if (status === "failed" || status === "blocked") {
		return "至少一封测试邮件没有发送成功，请按下方提示处理后重试。";
	}
	return "测试邮件正在发送，请保持页面打开查看结果。";
}

function deliveryStatusLabel(status: string): string {
	switch (status) {
		case "sent":
			return "已交给邮件服务商";
		case "failed":
			return "发送失败";
		case "suppressed":
			return "暂未发送";
		case "queued":
		case "pending":
			return "等待发送";
		case "running":
		case "sending":
			return "发送中";
		default:
			return "等待结果";
	}
}

function deliveryErrorMessage(kind: string): string {
	switch (kind) {
		case "authentication":
		case "configuration":
			return "邮件服务设置有误，请到“系统设置 > 系统邮件”检查账号、密码和发件人信息。";
		case "network":
		case "tls":
			return "暂时无法连接邮件服务，请稍后重试；如果持续失败，请联系系统管理员。";
		case "provider":
			return "邮件服务商拒绝了这封邮件，请检查收件人地址和发件人设置后重试。";
		default:
			return "这封邮件没有发送成功，请稍后重试；如果持续失败，请联系系统管理员。";
	}
}

export function summarizeNotificationChainTest(
	result: NotificationChainTestResult,
) {
	const providerAccepted = result.status === "passed";
	return {
		status: result.status,
		badge: notificationStatusBadge(result.status),
		providerAccepted,
		summary: chainSummary(result.status, providerAccepted),
		legs: [
			buildLeg("adminComment", "新评论通知站点人员", result.flows.adminComment),
			buildLeg(
				"commenterReply",
				"站点人员回复评论者",
				result.flows.commenterReply,
			),
		],
	};
}

function buildLeg(
	key: "adminComment" | "commenterReply",
	title: string,
	flow: NotificationChainTestResult["flows"]["adminComment"],
) {
	return {
		key,
		title,
		badge: notificationStatusBadge(flow.status),
		sentCount: flow.deliveries.filter((delivery) => delivery.status === "sent")
			.length,
		deliveries: flow.deliveries.map((delivery) => ({
			recipient: delivery.recipient,
			statusLabel: deliveryStatusLabel(delivery.status),
			errorMessage: delivery.error
				? deliveryErrorMessage(delivery.error.kind)
				: null,
		})),
	};
}
