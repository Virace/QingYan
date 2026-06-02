import type {
	AdminCommenter,
	AdminUser,
	NotificationChannel,
	NotificationChannelConfig,
	NotificationContentPolicy,
	SiteNotificationRoute,
	SiteNotificationEvent,
	SiteNotificationRecipient,
} from "../../api/admin";
import type { AdminTaskCenterItem } from "../../api/ops";

export const notificationChannelLabels: Record<NotificationChannel, string> = {
	email: "邮件",
	webhook: "Webhook",
	wxpusher: "WxPusher",
};

export const siteNotificationEventLabels: Record<
	SiteNotificationEvent,
	string
> = {
	admin_comment_pending: "新待审评论",
	admin_comment_approved: "评论通过",
};

export const contentPolicyLabels: Record<NotificationContentPolicy, string> = {
	none: "不包含评论内容",
	summary: "内容摘要",
	full: "完整内容",
};

export const notificationChannels = Object.keys(
	notificationChannelLabels,
) as NotificationChannel[];

export const siteNotificationEvents = Object.keys(
	siteNotificationEventLabels,
) as SiteNotificationEvent[];

export const contentPolicies = Object.keys(
	contentPolicyLabels,
) as NotificationContentPolicy[];

export function notificationChannelConfigLabel(
	config: Pick<NotificationChannelConfig, "name" | "type">,
) {
	return `${config.name}（${notificationChannelLabels[config.type]}）`;
}

export function availableNotificationChannelConfigs(
	configs: NotificationChannelConfig[],
) {
	return configs.filter((config) => config.enabled);
}

export function toggleListValue<T extends string>(
	values: T[],
	value: T,
	checked: boolean,
): T[] {
	if (checked) {
		return Array.from(new Set([...values, value]));
	}
	const next = values.filter((item) => item !== value);
	return next.length > 0 ? next : values;
}

export function buildRecipientInput(
	recipient: SiteNotificationRecipient,
): Omit<SiteNotificationRecipient, "username" | "email" | "displayName"> {
	return {
		userId: recipient.userId,
		channels: recipient.channels,
		events: recipient.events,
		routes: recipient.routes,
		includeCommentContent: recipient.includeCommentContent,
		rateLimitProfile: recipient.rateLimitProfile,
		enabled: recipient.enabled,
	};
}

export function addRecipientRoute(
	recipient: SiteNotificationRecipient,
	route: SiteNotificationRoute,
): SiteNotificationRecipient {
	const exists = recipient.routes.some(
		(item) =>
			item.eventType === route.eventType &&
			item.channelConfigId === route.channelConfigId,
	);
	return exists
		? recipient
		: {
				...recipient,
				routes: [...recipient.routes, route],
			};
}

export function removeRecipientRoute(
	recipient: SiteNotificationRecipient,
	route: Pick<SiteNotificationRoute, "eventType" | "channelConfigId">,
): SiteNotificationRecipient {
	const nextRoutes = recipient.routes.filter(
		(item) =>
			item.eventType !== route.eventType ||
			item.channelConfigId !== route.channelConfigId,
	);
	return nextRoutes.length === 0
		? recipient
		: {
				...recipient,
				routes: nextRoutes,
			};
}

export function eligibleNotificationRecipientUsers(
	users: AdminUser[],
	siteKey: string,
) {
	return users.filter(
		(user) =>
			user.status === "active" &&
			!user.deletedAt &&
			(user.groupKey === "admin" || user.siteKeys.includes(siteKey)),
	);
}

export function makeRecipientFromUser(
	user: AdminUser,
): SiteNotificationRecipient {
	return {
		userId: user.id,
		username: user.username,
		email: user.email,
		displayName: user.displayName,
		channels: ["email"],
		events: ["admin_comment_pending"],
		routes: [
			{
				eventType: "admin_comment_pending",
				channelConfigId: "email:default",
				channelType: "email",
				channelName: "默认邮件",
				enabled: true,
			},
		],
		includeCommentContent: "summary",
		rateLimitProfile: null,
		enabled: true,
	};
}

export type CommenterNotificationView =
	| {
			state: "available";
			badges: string[];
			details: string[];
	  }
	| {
			state: "api_missing";
			badges: string[];
			details: string[];
	  };

export function summarizeCommenterNotifications(
	commenter: AdminCommenter,
): CommenterNotificationView {
	const notifications = commenter.notifications;
	if (!notifications) {
		return {
			state: "api_missing",
			badges: ["通知状态待接入"],
			details: ["Admin 评论者 API 尚未返回退订、抑制、信誉评分和投递结果。"],
		};
	}

	const badges = [
		notifications.notifyOnReply ? "回复通知开启" : "回复通知关闭",
		notifications.unsubscribedAt ? "已退订" : "未退订",
		notifications.suppressedUntil ? "投递抑制中" : "未抑制",
	];
	const details = [
		`信誉评分：${notifications.reputationScore ?? "-"}`,
		`最近成功：${notifications.lastSuccessAt ?? "-"}`,
		`最近失败：${notifications.lastFailureAt ?? "-"}`,
		`抑制到期：${notifications.suppressedUntil ?? "-"}`,
	];

	return { state: "available", badges, details };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAtString(value: unknown, key: string) {
	if (!isRecord(value)) {
		return undefined;
	}
	const item = value[key];
	return typeof item === "string" && item.length > 0 ? item : undefined;
}

export function notificationTaskDetails(job: AdminTaskCenterItem) {
	const payloadSummary =
		"payloadSummary" in job && isRecord(job.payloadSummary)
			? job.payloadSummary
			: {};
	const payload = "payload" in job && isRecord(job.payload) ? job.payload : {};
	const delivery = isRecord(payload.delivery) ? payload.delivery : {};
	const error = isRecord(job.error) ? job.error : {};
	const result = isRecord(job.result) ? job.result : {};

	return {
		event:
			valueAtString(payloadSummary, "eventFamily") ??
			valueAtString(delivery, "eventFamily") ??
			valueAtString(payload, "eventType") ??
			"-",
		channel:
			valueAtString(payloadSummary, "channel") ??
			valueAtString(delivery, "channel") ??
			"-",
		channelConfig:
			valueAtString(payloadSummary, "channelConfigName") ??
			valueAtString(payloadSummary, "channelConfigId") ??
			valueAtString(delivery, "channelConfigNameSnapshot") ??
			valueAtString(delivery, "channelConfigRef") ??
			"-",
		recipientType:
			valueAtString(payloadSummary, "recipientType") ??
			valueAtString(delivery, "recipientType") ??
			"-",
		recipientAddress:
			valueAtString(payloadSummary, "recipientAddressSnapshot") ??
			valueAtString(delivery, "recipientAddressSnapshot") ??
			valueAtString(payloadSummary, "recipient") ??
			"-",
		providerMessageId:
			valueAtString(result, "providerMessageId") ??
			valueAtString(error, "providerMessageId") ??
			valueAtString(payloadSummary, "providerMessageId") ??
			"-",
		providerError:
			valueAtString(error, "providerMessage") ??
			valueAtString(error, "message") ??
			valueAtString(error, "code") ??
			"-",
	};
}
