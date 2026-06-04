import { describe, expect, it } from "vitest";

import type {
	AdminCommenter,
	AdminSystemSettings,
	AdminUser,
	NotificationChannelConfig,
} from "../../apps/admin/src/api/admin";
import type { TaskRunCenterItem } from "../../apps/admin/src/api/ops";
import {
	addRecipientRoute,
	availableNotificationChannelConfigs,
	cloneNotificationChannelConfigDraft,
	createNotificationChannelConfigDraft,
	eligibleNotificationRecipientUsers,
	mailChannelTestState,
	makeRecipientFromUser,
	notificationChannelConfigLabel,
	notificationChannelTargetSummary,
	notificationTaskDetails,
	notificationTestResultSummary,
	readSettingsTabFromSearch,
	removeRecipientRoute,
	summarizeCommenterNotifications,
	toggleListValue,
	writeSettingsTabToSearch,
	upsertNotificationChannelConfig,
} from "../../apps/admin/src/components/admin/notification-ui-model";

function user(input: Partial<AdminUser> & Pick<AdminUser, "id" | "username">) {
	return {
		id: input.id,
		username: input.username,
		email: input.email ?? `${input.username}@example.com`,
		displayName: input.displayName ?? input.username,
		status: input.status ?? "active",
		groupKey: input.groupKey ?? "site_moderator",
		groupName: input.groupName ?? "站点审核员",
		siteKeys: input.siteKeys ?? ["default"],
		isInitialAdmin: false,
		passwordChangeRequired: false,
		loginBlockedUntil: null,
		activeSessionCount: 0,
		lastSessionSeenAt: null,
		lastLoginAt: null,
		createdAt: "2026-06-02T00:00:00.000Z",
		updatedAt: "2026-06-02T00:00:00.000Z",
		deletedAt: input.deletedAt ?? null,
	} satisfies AdminUser;
}

function commenter(input: Partial<AdminCommenter> = {}) {
	return {
		email: "reader@example.com",
		emailVariants: ["Reader@example.com"],
		names: ["Reader"],
		commentCount: 3,
		pendingCount: 1,
		approvedCount: 2,
		lastCommentAt: "2026-06-02T00:00:00.000Z",
		pageCount: 2,
		siteCount: 1,
		ips: [],
		userAgents: [],
		ipLocations: [],
		devices: [],
		blacklist: { email: false },
		isBlacklisted: false,
		...input,
	} satisfies AdminCommenter;
}

function notificationTask(input: Partial<TaskRunCenterItem> = {}) {
	const item: TaskRunCenterItem = {
		source: "task_run",
		id: "task_1",
		scheduledTaskId: null,
		scheduledTaskNameSnapshot: null,
		queueBackend: "database",
		queueMessageId: "msg_1",
		type: "comment_notification",
		category: "notification",
		status: "retrying",
		siteId: 1,
		siteKey: "default",
		scopeKind: "site",
		trigger: "scheduled",
		ownerUserIdSnapshot: 1,
		createdByUserId: null,
		skipReason: null,
		blockReason: null,
		visibility: "run_detail",
		canViewLogs: true,
		actorType: "system",
		actorId: null,
		subjectType: "comment",
		subjectId: "comment_1",
		payloadSummary: {
			eventFamily: "admin_comment_pending",
			channel: "webhook",
			channelConfigId: "webhook:ops",
			channelConfigName: "运维 Webhook",
			recipientType: "backend_user",
			recipientAddressSnapshot: "https://example.com/hook",
		},
		payload: null,
		scope: null,
		triggerSnapshot: null,
		input: null,
		actionConfigSnapshot: null,
		progress: null,
		result: { providerMessageId: "provider_msg_1" },
		error: { providerMessage: "remote 500" },
		idempotencyKey: "idem_1",
		runAfter: "2026-06-02T00:05:00.000Z",
		attempts: 2,
		maxAttempts: 3,
		retryDelaySec: 60,
		priority: 0,
		concurrencyKey: null,
		workerId: null,
		lockConflictWithRunId: null,
		lockConflictWithTaskName: null,
		createdAt: "2026-06-02T00:00:00.000Z",
		startedAt: null,
		finishedAt: null,
		updatedAt: "2026-06-02T00:01:00.000Z",
		queueState: {
			waitingReason: "retry_wait",
			waitingDescription: "等待重试。",
			readyAt: "2026-06-02T00:05:00.000Z",
		},
		...input,
	};
	return item;
}

function mailSettings(
	input: Partial<AdminSystemSettings["mail"]> = {},
): Pick<AdminSystemSettings, "mail"> {
	return {
		mail: {
			enabled: false,
			smtp: {
				host: "",
				port: 587,
				secure: false,
				username: "",
				password: "",
				passwordConfigured: false,
				from: "",
			},
			...input,
		},
	};
}

function webhookConfig(
	input: Partial<NotificationChannelConfig> = {},
): NotificationChannelConfig {
	return {
		id: "webhook:ops",
		type: "webhook",
		name: "运维 Webhook",
		description: null,
		enabled: true,
		config: { url: "https://hooks.example.test/qingyan?token=secret" },
		secretConfig: {},
		secretConfigured: true,
		...input,
	};
}

describe("notification UI model", () => {
	it("filters notification recipient candidates by active site access", () => {
		const users = [
			user({ id: 1, username: "root", groupKey: "admin", siteKeys: [] }),
			user({ id: 2, username: "mod", siteKeys: ["default"] }),
			user({ id: 3, username: "other", siteKeys: ["other"] }),
			user({ id: 4, username: "disabled", status: "disabled" }),
			user({ id: 5, username: "deleted", deletedAt: "2026-06-02" }),
		];

		const candidates = eligibleNotificationRecipientUsers(users, "default");

		expect(candidates.map((item) => item.username)).toEqual(["root", "mod"]);
		expect(makeRecipientFromUser(users[1])).toMatchObject({
			userId: 2,
			channels: ["email"],
			events: ["admin_comment_pending"],
			routes: [
				expect.objectContaining({
					eventType: "admin_comment_pending",
					channelConfigId: "email:default",
					channelType: "email",
					channelName: "默认邮件",
				}),
			],
			includeCommentContent: "summary",
			enabled: true,
		});
	});

	it("builds recipient routes from concrete channel configs", () => {
		const recipient = makeRecipientFromUser(user({ id: 2, username: "mod" }));
		const withWebhook = addRecipientRoute(recipient, {
			eventType: "admin_comment_pending",
			channelConfigId: "webhook:ops",
			channelType: "webhook",
			channelName: "运维 Webhook",
			enabled: true,
		});

		expect(withWebhook.routes).toHaveLength(2);
		expect(
			addRecipientRoute(withWebhook, {
				eventType: "admin_comment_pending",
				channelConfigId: "webhook:ops",
				channelType: "webhook",
				channelName: "运维 Webhook",
				enabled: true,
			}).routes,
		).toHaveLength(2);
		expect(
			removeRecipientRoute(withWebhook, {
				eventType: "admin_comment_pending",
				channelConfigId: "webhook:ops",
			}).routes,
		).toHaveLength(1);
		expect(
			removeRecipientRoute(recipient, {
				eventType: "admin_comment_pending",
				channelConfigId: "email:default",
			}).routes,
		).toHaveLength(1);
		expect(
			notificationChannelConfigLabel({
				name: "内容审核 WxPusher",
				type: "wxpusher",
			}),
		).toBe("内容审核 WxPusher（WxPusher）");
		expect(
			availableNotificationChannelConfigs([
				{
					id: "email:default",
					type: "email",
					name: "默认邮件",
					description: null,
					enabled: true,
					config: {},
				},
				{
					id: "webhook:off",
					type: "webhook",
					name: "停用 Webhook",
					description: null,
					enabled: false,
					config: {},
				},
			]).map((config) => config.id),
		).toEqual(["email:default"]);
	});

	it("creates and applies channel config dialog drafts without mutating the source list", () => {
		const created = createNotificationChannelConfigDraft("webhook", 1234);
		expect(created).toMatchObject({
			id: "webhook:1234",
			type: "webhook",
			name: "新的 Webhook",
			config: { url: "" },
		});

		const original = webhookConfig();
		const draft = cloneNotificationChannelConfigDraft(original);
		draft.name = "修改后的 Webhook";
		draft.config.url = "https://hooks.example.test/changed";
		draft.secretConfig = { secret: "next-secret" };

		expect(original.name).toBe("运维 Webhook");
		expect(original.config.url).toBe(
			"https://hooks.example.test/qingyan?token=secret",
		);
		expect(original.secretConfig).toEqual({});
		expect(upsertNotificationChannelConfig([original], draft)).toEqual([draft]);
		expect(upsertNotificationChannelConfig([], created)).toEqual([created]);
	});

	it("summarizes channel targets and mail test availability", () => {
		expect(notificationChannelTargetSummary(webhookConfig())).toBe(
			"https://hooks.example.test/qingyan",
		);
		expect(
			notificationChannelTargetSummary(webhookConfig({ config: { url: "" } })),
		).toBe("未配置 Webhook URL");
		expect(
			notificationChannelTargetSummary({
				id: "wxpusher:audit",
				type: "wxpusher",
				name: "审计 WxPusher",
				description: null,
				enabled: true,
				config: { targetSummary: "UID_admin" },
			}),
		).toBe("UID_admin");

		expect(
			mailChannelTestState({
				settings: mailSettings(),
				dirty: false,
			}),
		).toEqual({
			testable: false,
			reason: "系统邮件未启用；SMTP Host 不能为空；发件人不能为空",
		});
		expect(
			mailChannelTestState({
				settings: mailSettings({
					enabled: true,
					smtp: {
						host: "smtp.example.test",
						port: 587,
						secure: false,
						username: "notify@example.test",
						passwordConfigured: true,
						from: "notify@example.test",
					},
				}),
				dirty: true,
			}),
		).toEqual({
			testable: false,
			reason: "请先保存邮件设置",
		});
	});

	it("formats notification test task results as created tasks", () => {
		expect(
			notificationTestResultSummary({
				taskId: "task_1",
				deliveryId: "delivery_1",
				channelName: "默认邮件",
				channel: "email",
				recipient: "admin@example.test",
			}),
		).toBe(
			"已创建测试任务 task_1，投递记录 delivery_1，通道 默认邮件，收件人 admin@example.test。",
		);
	});

	it("keeps channel and event lists non-empty while toggling", () => {
		expect(toggleListValue(["email"], "webhook", true)).toEqual([
			"email",
			"webhook",
		]);
		expect(toggleListValue(["email"], "email", false)).toEqual(["email"]);
		expect(toggleListValue(["email", "webhook"], "email", false)).toEqual([
			"webhook",
		]);
	});

	it("reads and writes settings tab query values without disturbing outer view", () => {
		expect(
			readSettingsTabFromSearch("?view=settings&systemTab=mail", {
				param: "systemTab",
				allowed: ["security", "mail", "notifications"],
				fallback: "security",
			}),
		).toBe("mail");
		expect(
			readSettingsTabFromSearch("?view=settings&systemTab=unknown", {
				param: "systemTab",
				allowed: ["security", "mail", "notifications"],
				fallback: "security",
			}),
		).toBe("security");

		expect(
			writeSettingsTabToSearch("?view=settings&siteTab=comments", {
				param: "siteTab",
				value: "notifications",
			}),
		).toBe("?view=settings&siteTab=notifications");
		expect(
			writeSettingsTabToSearch("?view=system-settings&systemTab=security", {
				param: "systemTab",
				value: "mail",
			}),
		).toBe("?view=system-settings&systemTab=mail");
	});

	it("surfaces commenter notification API gaps without pretending data exists", () => {
		const missing = summarizeCommenterNotifications(commenter());
		expect(missing.state).toBe("api_missing");
		expect(missing.badges).toContain("通知状态待接入");

		const available = summarizeCommenterNotifications(
			commenter({
				notifications: {
					notifyOnReply: true,
					unsubscribedAt: null,
					suppressedUntil: "2026-06-03T00:00:00.000Z",
					reputationScore: 92,
					lastSuccessAt: "2026-06-02T01:00:00.000Z",
					lastFailureAt: null,
				},
			}),
		);

		expect(available.state).toBe("available");
		expect(available.badges).toEqual(["回复通知开启", "未退订", "投递抑制中"]);
		expect(available.details).toContain("信誉评分：92");
	});

	it("extracts notification task center details from payload summary and provider fields", () => {
		const details = notificationTaskDetails(notificationTask());

		expect(details).toEqual({
			event: "admin_comment_pending",
			channel: "webhook",
			channelConfig: "运维 Webhook",
			recipientType: "backend_user",
			recipientAddress: "https://example.com/hook",
			providerMessageId: "provider_msg_1",
			providerError: "remote 500",
		});
	});
});
