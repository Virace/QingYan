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
			status: "blocked",
			recipients: [],
			blockers: [
				{
					code: "no_enabled_backend_recipient",
					path: "notifications.backend.recipients",
					message: "没有可接收已发布评论邮件的站点人员。",
				},
			],
			warnings: [],
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
			label: "可发送",
			variant: "secondary",
		});
		expect(notificationStatusBadge("conditional")).toEqual({
			label: "需确认",
			variant: "outline",
		});
		expect(notificationStatusBadge("blocked")).toEqual({
			label: "已阻断",
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

	it("builds three compact flow rows and keeps blockers separate from warnings", () => {
		expect(diagnosticFlowRows(diagnostics)).toEqual([
			expect.objectContaining({
				key: "admin_comment_pending_email",
				title: "待审核评论 → 站点人员",
				badge: { label: "可发送", variant: "secondary" },
				blockers: [],
				recipients: ["站点人员（owner@example.com）"],
			}),
			expect.objectContaining({
				key: "admin_comment_approved_email",
				title: "直接发布评论 → 站点人员",
				blockers: [
					{
						code: "no_enabled_backend_recipient",
						path: "notifications.backend.recipients",
						message: "没有可接收已发布评论邮件的站点人员。",
					},
				],
				warnings: [],
			}),
			expect.objectContaining({
				key: "commenter_reply_email",
				title: "站点人员回复 → 原评论者",
				blockers: [],
				warnings: [
					expect.objectContaining({ code: "commenter_email_required" }),
				],
			}),
		]);
	});

	it("summarizes both real-test legs and explains provider acceptance", () => {
		expect(summarizeNotificationChainTest(passedChain)).toEqual({
			runId: "task_chain",
			status: "passed",
			badge: { label: "已通过", variant: "secondary" },
			providerAccepted: true,
			summary:
				"两条评论邮件链路均已被邮件服务商接受；这不等于已经进入收件箱，请继续核对两个收件箱。",
			legs: [
				{
					key: "adminComment",
					title: "评论 A → 站点人员",
					badge: { label: "已通过", variant: "secondary" },
					sentCount: 1,
					taskIds: ["task_admin"],
					deliveries: passedChain.flows.adminComment.deliveries,
				},
				{
					key: "commenterReply",
					title: "站点人员回复 → 评论 A 的用户",
					badge: { label: "已通过", variant: "secondary" },
					sentCount: 1,
					taskIds: ["task_commenter"],
					deliveries: passedChain.flows.commenterReply.deliveries,
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
			"真实评论邮件测试已超时，请检查通知 worker、队列与 SMTP 状态。",
		);
		expect(failed.legs[1]).toMatchObject({
			badge: { label: "已超时", variant: "destructive" },
			sentCount: 0,
		});
	});

	it("only blocks a real test for the configured comment status and reply flow", () => {
		expect(notificationChainTestBlockers(diagnostics, "pending")).toEqual([]);
		expect(notificationChainTestBlockers(diagnostics, "approved")).toEqual([
			{
				code: "no_enabled_backend_recipient",
				path: "notifications.backend.recipients",
				message: "没有可接收已发布评论邮件的站点人员。",
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
