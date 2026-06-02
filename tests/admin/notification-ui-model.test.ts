import { describe, expect, it } from "vitest";

import type { AdminCommenter, AdminUser } from "../../apps/admin/src/api/admin";
import type { TaskRunCenterItem } from "../../apps/admin/src/api/ops";
import {
	addRecipientRoute,
	availableNotificationChannelConfigs,
	eligibleNotificationRecipientUsers,
	makeRecipientFromUser,
	notificationChannelConfigLabel,
	notificationTaskDetails,
	removeRecipientRoute,
	summarizeCommenterNotifications,
	toggleListValue,
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
	return {
		source: "task_run",
		id: "task_1",
		queueBackend: "database",
		queueMessageId: "msg_1",
		type: "comment_notification",
		category: "notification",
		status: "retrying",
		siteId: 1,
		siteKey: "default",
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
		progress: null,
		result: { providerMessageId: "provider_msg_1" },
		error: { providerMessage: "remote 500" },
		idempotencyKey: "idem_1",
		runAfter: "2026-06-02T00:05:00.000Z",
		attempts: 2,
		maxAttempts: 3,
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
	} satisfies TaskRunCenterItem;
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
