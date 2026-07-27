import { describe, expect, it } from "vitest";

import type {
	NotificationChainTestResult,
	NotificationDiagnostic,
} from "../../apps/admin/src/api/admin";
import {
	diagnosticFlowRows,
	notificationChainTestBlockers,
	notificationChainTestPollInterval,
	notificationStatusBadge,
	summarizeNotificationChainTest,
} from "../../apps/admin/src/components/admin/settings/notification-diagnostics-model";

const diagnostics: NotificationDiagnostic = {
	generatedAt: "2026-07-27T00:00:00.000Z",
	overall: "blocked",
	savedConfigOnly: true,
	runtime: {
		notificationWorker: "ready",
		queueBackend: "database",
		lastTickAt: "2026-07-27T00:00:00.000Z",
	},
	flows: [
		{
			key: "admin_comment_pending_email",
			status: "ready",
			recipients: [
				{
					userId: 1,
					displayName: "站点人员",
					email: "owner@example.com",
					status: "ready",
					notes: [],
				},
			],
			blockers: [],
			warnings: [],
		},
		{
			key: "admin_comment_approved_email",
			status: "not_sending",
			recipients: [],
			blockers: [],
			warnings: [
				{
					code: "event_has_no_targets",
					message: "当前通知类型没有选择接收人，因此不会发送。",
				},
			],
		},
		{
			key: "commenter_reply_email",
			status: "conditional",
			recipients: [],
			blockers: [],
			warnings: [
				{
					code: "commenter_email_required",
					message: "真实测试需要评论者邮箱。",
				},
			],
		},
	],
};

const passedChain: NotificationChainTestResult = {
	runId: "task_chain",
	status: "passed",
	createdAt: "2026-07-27T00:00:00.000Z",
	finishedAt: "2026-07-27T00:00:03.000Z",
	message: "两条邮件均已被 provider 接受。",
	flows: {
		adminComment: {
			status: "passed",
			taskIds: ["task_admin"],
			deliveries: [
				{
					deliveryId: "delivery_admin",
					recipient: "owner@example.com",
					status: "sent",
					providerMessageId: "provider-admin",
				},
			],
		},
		commenterReply: {
			status: "passed",
			taskIds: ["task_commenter"],
			deliveries: [
				{
					deliveryId: "delivery_commenter",
					recipient: "reader@example.com",
					status: "sent",
					providerMessageId: "provider-commenter",
				},
			],
		},
	},
};

describe("notification diagnostics model", () => {
	it("maps diagnostic and chain statuses to stable badges", () => {
		expect(notificationStatusBadge("ready")).toEqual({
			label: "可以发送",
			variant: "secondary",
		});
		expect(notificationStatusBadge("conditional")).toEqual({
			label: "发送时确认",
			variant: "outline",
		});
		expect(notificationStatusBadge("blocked")).toEqual({
			label: "需要设置",
			variant: "destructive",
		});
		expect(notificationStatusBadge("running")).toEqual({
			label: "发送中",
			variant: "outline",
		});
		expect(notificationStatusBadge("passed")).toEqual({
			label: "已通过",
			variant: "secondary",
		});
	});

	it("builds compact flow rows with user-facing actions", () => {
		expect(diagnosticFlowRows(diagnostics)).toEqual([
			expect.objectContaining({
				key: "admin_comment_pending_email",
				title: "待审核评论通知",
				description: "新评论进入审核时，向站点人员发送邮件",
				badge: { label: "可以发送", variant: "secondary" },
				blockerMessages: [],
				warningMessages: [],
				recipients: ["站点人员（owner@example.com）"],
			}),
			expect.objectContaining({
				key: "admin_comment_approved_email",
				title: "直接发布评论通知",
				description: "评论直接发布时，向站点人员发送邮件",
				badge: { label: "不会发送", variant: "outline" },
				blockerMessages: [],
				warningMessages: ["当前没有选择接收人，因此不会发送这类通知。"],
				recipientEmptyText: "还没有可接收这类邮件的站点人员",
				recipients: [],
			}),
			expect.objectContaining({
				key: "commenter_reply_email",
				title: "评论回复通知",
				description: "站点人员回复评论时，向原评论者发送邮件",
				badge: { label: "发送时确认", variant: "outline" },
				blockerMessages: [],
				warningMessages: [
					"评论者填写有效邮箱并勾选“有人回复时邮件通知我”后，系统才会发送回复提醒。",
				],
				recipientEmptyText: "收件人将在评论者订阅回复提醒后确定",
			}),
		]);
	});

	it("turns recipient availability diagnostics into actionable guidance without exposing internal details", () => {
		const recipientDiagnostic: NotificationDiagnostic = {
			...diagnostics,
			flows: diagnostics.flows.map((flow) =>
				flow.key === "admin_comment_approved_email"
					? {
							...flow,
							status: "blocked" as const,
							recipients: [
								{
									userId: 7,
									displayName: "Virace",
									email: "virace@example.com",
									status: "blocked" as const,
									notes: [],
								},
							],
							blockers: [
								{
									code: "event_email_recipient_inactive",
									message: "选择的接收人当前不可用。",
								},
							],
							warnings: [],
						}
					: flow,
			),
		};

		const approved = diagnosticFlowRows(recipientDiagnostic).find(
			(row) => row.key === "admin_comment_approved_email",
		);

		expect(approved?.blockerMessages).toEqual([
			"请在当前站点的“评论通知”中更换为已启用的后台用户，然后保存设置。",
		]);
		expect(JSON.stringify(approved?.blockerMessages)).not.toContain("route");
		expect(JSON.stringify(approved?.blockerMessages)).not.toContain(
			"admin_comment_approved",
		);
		expect(JSON.stringify(approved?.blockerMessages)).not.toContain(
			"notifications.backend",
		);
	});

	it("merges commenter delivery conditions into one plain-language explanation", () => {
		const repeatedWarnings: NotificationDiagnostic = {
			...diagnostics,
			flows: diagnostics.flows.map((flow) =>
				flow.key === "commenter_reply_email"
					? {
							...flow,
							warnings: [
								{
									code: "commenter_email_required",
									message: "实际投递需要评论者提供有效邮箱。",
								},
								{
									code: "commenter_opt_in_required",
									message: "实际投递需要评论者显式订阅回复提醒。",
								},
								{
									code: "commenter_reputation_check_required",
									message: "实际投递前需要检查邮箱是否处于 suppression。",
								},
							],
						}
					: flow,
			),
		};

		const commenter = diagnosticFlowRows(repeatedWarnings).find(
			(row) => row.key === "commenter_reply_email",
		);

		expect(commenter?.warningMessages).toEqual([
			"评论者填写有效邮箱并勾选“有人回复时邮件通知我”后，系统才会发送回复提醒。",
		]);
		expect(JSON.stringify(commenter)).not.toContain("suppression");
	});

	it("uses a safe recovery message for unknown diagnostics", () => {
		const unknownDiagnostic: NotificationDiagnostic = {
			...diagnostics,
			flows: diagnostics.flows.map((flow) =>
				flow.key === "admin_comment_approved_email"
					? {
							...flow,
							blockers: [
								{
									code: "future_internal_check",
									path: "runtime.future.secret",
									message: "Internal debug output must not reach the UI.",
								},
							],
						}
					: flow,
			),
		};

		const approved = diagnosticFlowRows(unknownDiagnostic).find(
			(row) => row.key === "admin_comment_approved_email",
		);

		expect(approved?.blockerMessages).toEqual([
			"当前设置还不能发送这类邮件，请按页面中的通知设置逐项检查，或联系系统管理员。",
		]);
		expect(JSON.stringify(approved)).not.toContain("Internal debug output");
		expect(JSON.stringify(approved)).not.toContain("runtime.future.secret");
	});

	it("summarizes both real-test legs without exposing task or delivery identifiers", () => {
		expect(summarizeNotificationChainTest(passedChain)).toEqual({
			status: "passed",
			badge: { label: "已通过", variant: "secondary" },
			providerAccepted: true,
			summary:
				"两类测试邮件均已被邮件服务商接受；这不等于已经进入收件箱，请继续核对两个收件箱。",
			legs: [
				{
					key: "adminComment",
					title: "新评论通知站点人员",
					badge: { label: "已通过", variant: "secondary" },
					sentCount: 1,
					deliveries: [
						{
							recipient: "owner@example.com",
							statusLabel: "已交给邮件服务商",
							errorMessage: null,
						},
					],
				},
				{
					key: "commenterReply",
					title: "站点人员回复评论者",
					badge: { label: "已通过", variant: "secondary" },
					sentCount: 1,
					deliveries: [
						{
							recipient: "reader@example.com",
							statusLabel: "已交给邮件服务商",
							errorMessage: null,
						},
					],
				},
			],
		});
	});

	it("does not call failed or timed-out runs provider accepted", () => {
		const failed = summarizeNotificationChainTest({
			...passedChain,
			status: "timed_out",
			flows: {
				...passedChain.flows,
				commenterReply: {
					...passedChain.flows.commenterReply,
					status: "timed_out",
					deliveries: [
						{
							deliveryId: "delivery_commenter",
							recipient: "reader@example.com",
							status: "failed",
							error: {
								kind: "network",
								message: "SMTP 网络连接失败。",
							},
						},
					],
				},
			},
		});

		expect(failed.providerAccepted).toBe(false);
		expect(failed.summary).toBe(
			"测试等待时间过长。请稍后重试；如果仍未完成，请联系系统管理员检查邮件发送服务。",
		);
		expect(failed.legs[1]).toMatchObject({
			badge: { label: "已超时", variant: "destructive" },
			sentCount: 0,
			deliveries: [
				{
					recipient: "reader@example.com",
					statusLabel: "发送失败",
					errorMessage:
						"暂时无法连接邮件服务，请稍后重试；如果持续失败，请联系系统管理员。",
				},
			],
		});
		expect(JSON.stringify(failed)).not.toContain("SMTP");
		expect(JSON.stringify(failed)).not.toContain("network");
		expect(JSON.stringify(failed)).not.toContain("delivery_commenter");
	});

	it("only blocks a real test for the configured comment status and reply flow", () => {
		expect(notificationChainTestBlockers(diagnostics, "pending")).toEqual([]);
		expect(notificationChainTestBlockers(diagnostics, "approved")).toEqual([
			{
				code: "event_email_recipient_required",
				message: "请先为“直接发布评论”选择至少一名站点人员并应用更改。",
			},
		]);

		const externalOnly: NotificationDiagnostic = {
			...diagnostics,
			flows: diagnostics.flows.map((flow) =>
				flow.key === "admin_comment_pending_email"
					? { ...flow, status: "ready", recipients: [] }
					: flow,
			),
		};
		expect(notificationChainTestBlockers(externalOnly, "pending")).toEqual([
			{
				code: "event_email_recipient_required",
				message: "请先为“新待审评论”选择至少一名站点人员并应用更改。",
			},
		]);
	});

	it("deduplicates blockers shared by the selected administrator and commenter flows", () => {
		const sharedBlocker = {
			code: "mail_disabled",
			path: "mail.enabled",
			message: "系统邮件总开关未启用。",
		};
		const withSharedBlocker: NotificationDiagnostic = {
			...diagnostics,
			flows: diagnostics.flows.map((flow) =>
				flow.key === "admin_comment_pending_email" ||
				flow.key === "commenter_reply_email"
					? { ...flow, blockers: [sharedBlocker] }
					: flow,
			),
		};

		expect(notificationChainTestBlockers(withSharedBlocker, "pending")).toEqual(
			[sharedBlocker],
		);
	});
	it("polls active runs and stops after every terminal state", () => {
		expect(notificationChainTestPollInterval()).toBe(false);
		expect(notificationChainTestPollInterval("checking")).toBe(1500);
		expect(notificationChainTestPollInterval("queued")).toBe(1500);
		expect(notificationChainTestPollInterval("running")).toBe(1500);
		expect(notificationChainTestPollInterval("passed")).toBe(false);
		expect(notificationChainTestPollInterval("blocked")).toBe(false);
		expect(notificationChainTestPollInterval("failed")).toBe(false);
		expect(notificationChainTestPollInterval("timed_out")).toBe(false);
	});
});
