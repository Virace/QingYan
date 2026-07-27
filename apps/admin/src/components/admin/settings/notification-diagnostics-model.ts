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

const diagnosticFlowTitles: Record<NotificationDiagnosticFlowKey, string> = {
	admin_comment_pending_email: "待审核评论 → 站点人员",
	admin_comment_approved_email: "直接发布评论 → 站点人员",
	commenter_reply_email: "站点人员回复 → 原评论者",
};

export function notificationStatusBadge(
	status: NotificationDiagnosticStatus | NotificationChainTestStatus,
): NotificationStatusBadge {
	switch (status) {
		case "ready":
			return { label: "可发送", variant: "secondary" };
		case "conditional":
			return { label: "需确认", variant: "outline" };
		case "blocked":
			return { label: "已阻断", variant: "destructive" };
		case "checking":
			return { label: "检查中", variant: "outline" };
		case "queued":
			return { label: "已排队", variant: "outline" };
		case "running":
			return { label: "发送中", variant: "outline" };
		case "passed":
			return { label: "已通过", variant: "secondary" };
		case "failed":
			return { label: "失败", variant: "destructive" };
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

export function diagnosticFlowRows(diagnostic: NotificationDiagnostic) {
	return diagnostic.flows.map((flow) => ({
		key: flow.key,
		title: diagnosticFlowTitles[flow.key],
		badge: notificationStatusBadge(flow.status),
		blockers: flow.blockers,
		warnings: flow.warnings,
		recipients: flow.recipients.map(recipientLabel),
	}));
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
		return "两条评论邮件链路均已被邮件服务商接受；这不等于已经进入收件箱，请继续核对两个收件箱。";
	}
	if (status === "timed_out") {
		return "真实评论邮件测试已超时，请检查通知 worker、队列与 SMTP 状态。";
	}
	if (status === "failed" || status === "blocked") {
		return "至少一条评论邮件链路未通过，请展开投递详情查看失败原因。";
	}
	return "真实评论邮件正在通过正式通知队列发送，请保持页面打开以查看结果。";
}

export function summarizeNotificationChainTest(
	result: NotificationChainTestResult,
) {
	const providerAccepted = result.status === "passed";
	return {
		runId: result.runId,
		status: result.status,
		badge: notificationStatusBadge(result.status),
		providerAccepted,
		summary: chainSummary(result.status, providerAccepted),
		legs: [
			buildLeg("adminComment", "评论 A → 站点人员", result.flows.adminComment),
			buildLeg(
				"commenterReply",
				"站点人员回复 → 评论 A 的用户",
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
		taskIds: flow.taskIds,
		deliveries: flow.deliveries,
	};
}

export function issueText(issue: NotificationDiagnosticIssue): string {
	return issue.path ? `${issue.message}（${issue.path}）` : issue.message;
}
