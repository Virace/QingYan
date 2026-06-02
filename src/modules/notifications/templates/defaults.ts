import type { NotificationTemplateFormat } from "./renderer";

export interface DefaultNotificationTemplate {
	key: string;
	name: string;
	description: string;
	channel: "email" | "webhook" | "wxpusher";
	channelLabel: string;
	channelDescription: string;
	eventType: string;
	eventLabel: string;
	eventDescription: string;
	format: NotificationTemplateFormat;
	formatLabel: string;
	subjectTemplate?: string;
	bodyTemplate: string;
}

const channelMetadata = {
	email: {
		label: "邮件",
		description: "通过 SMTP 向评论者或后台用户发送通知。",
	},
	webhook: {
		label: "Webhook",
		description: "向已配置的 Webhook 地址推送后台用户通知。",
	},
	wxpusher: {
		label: "WxPusher",
		description: "通过 WxPusher 配置向后台用户推送通知。",
	},
} as const;

const eventMetadata: Record<string, { label: string; description: string }> = {
	admin_comment_pending: {
		label: "新评论待审核",
		description: "有新评论进入待审核队列时触发，面向站点管理人员。",
	},
	admin_comment_approved: {
		label: "评论已发布",
		description: "新评论直接发布时触发，面向站点管理人员。",
	},
	reply_approved: {
		label: "评论回复已通过",
		description: "评论者订阅的评论收到已审核回复时触发。",
	},
	channel_test: {
		label: "通知通道测试",
		description: "管理员手动测试通知通道时触发。",
	},
};

const formatMetadata: Record<NotificationTemplateFormat, { label: string }> = {
	text: { label: "纯文本" },
	html: { label: "HTML" },
	json: { label: "JSON" },
};

function withMetadata(
	template: Omit<
		DefaultNotificationTemplate,
		| "channelLabel"
		| "channelDescription"
		| "eventLabel"
		| "eventDescription"
		| "formatLabel"
	>,
): DefaultNotificationTemplate {
	return {
		...template,
		channelLabel: channelMetadata[template.channel].label,
		channelDescription: channelMetadata[template.channel].description,
		eventLabel: eventMetadata[template.eventType]?.label ?? template.eventType,
		eventDescription:
			eventMetadata[template.eventType]?.description ?? template.eventType,
		formatLabel: formatMetadata[template.format].label,
	};
}

export const defaultNotificationTemplates: DefaultNotificationTemplate[] = [
	withMetadata({
		key: "backend_comment_pending_email_text",
		name: "新评论待审核 - 纯文本邮件",
		description: "待审评论创建后，通过邮件提醒站点管理人员处理。",
		channel: "email",
		eventType: "admin_comment_pending",
		format: "text",
		subjectTemplate: "[{{site.name}}] 新评论待审核",
		bodyTemplate: "{{comment.authorName}} 在 {{page.title}} 发表了待审核评论。",
	}),
	withMetadata({
		key: "backend_comment_pending_email_html",
		name: "新评论待审核 - HTML 邮件",
		description: "待审评论创建后，通过 HTML 邮件提醒站点管理人员处理。",
		channel: "email",
		eventType: "admin_comment_pending",
		format: "html",
		subjectTemplate: "[{{site.name}}] 新评论待审核",
		bodyTemplate:
			"<p>{{comment.authorName}} 在 {{page.title}} 发表了待审核评论。</p>",
	}),
	withMetadata({
		key: "backend_comment_approved_email_text",
		name: "评论已发布 - 纯文本邮件",
		description: "评论直接发布后，通过邮件提醒站点管理人员。",
		channel: "email",
		eventType: "admin_comment_approved",
		format: "text",
		subjectTemplate: "[{{site.name}}] 新评论已发布",
		bodyTemplate: "{{comment.authorName}} 在 {{page.title}} 的评论已发布。",
	}),
	withMetadata({
		key: "backend_comment_approved_email_html",
		name: "评论已发布 - HTML 邮件",
		description: "评论直接发布后，通过 HTML 邮件提醒站点管理人员。",
		channel: "email",
		eventType: "admin_comment_approved",
		format: "html",
		subjectTemplate: "[{{site.name}}] 新评论已发布",
		bodyTemplate:
			"<p>{{comment.authorName}} 在 {{page.title}} 的评论已发布。</p>",
	}),
	withMetadata({
		key: "commenter_reply_approved_email_text",
		name: "评论回复提醒 - 纯文本邮件",
		description: "评论者订阅的评论收到已审核回复后，发送纯文本邮件提醒。",
		channel: "email",
		eventType: "reply_approved",
		format: "text",
		subjectTemplate: "[{{site.name}}] 你的评论有新回复",
		bodyTemplate:
			"{{comment.authorName}} 回复了你在 {{page.title}} 的评论。\n{{links.unsubscribe}}",
	}),
	withMetadata({
		key: "commenter_reply_approved_email_html",
		name: "评论回复提醒 - HTML 邮件",
		description: "评论者订阅的评论收到已审核回复后，发送 HTML 邮件提醒。",
		channel: "email",
		eventType: "reply_approved",
		format: "html",
		subjectTemplate: "[{{site.name}}] 你的评论有新回复",
		bodyTemplate:
			'<p>{{comment.authorName}} 回复了你在 {{page.title}} 的评论。</p><p><a href="{{links.unsubscribe}}">退订</a></p>',
	}),
	withMetadata({
		key: "channel_test",
		name: "通知通道测试 - 纯文本邮件",
		description: "管理员测试通知通道时使用的默认测试消息。",
		channel: "email",
		eventType: "channel_test",
		format: "text",
		subjectTemplate: "[{{site.name}}] QingYan 通道测试",
		bodyTemplate: "这是一封 QingYan 通知通道测试消息。",
	}),
	withMetadata({
		key: "backend_comment_webhook_json",
		name: "新评论待审核 - Webhook JSON",
		description: "待审评论创建后，向后台通知 Webhook 发送 JSON 负载。",
		channel: "webhook",
		eventType: "admin_comment_pending",
		format: "json",
		bodyTemplate:
			'{"site":{{json site.name}},"page":{{json page.title}},"comment":{{json comment.content}},"url":{{json links.adminComment}}}',
	}),
];
