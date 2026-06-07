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
	triggerDescription: string;
	recipientType: string;
	placeholders: NotificationTemplatePlaceholder[];
	format: NotificationTemplateFormat;
	formatLabel: string;
	supportsSubject: boolean;
	subjectTemplate?: string;
	bodyTemplate: string;
}

export interface NotificationTemplatePlaceholder {
	path: string;
	label: string;
	description: string;
	jsonSupported: boolean;
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

const commonPlaceholders: NotificationTemplatePlaceholder[] = [
	{
		path: "site.name",
		label: "站点名称",
		description: "当前站点展示名称。",
		jsonSupported: true,
	},
	{
		path: "page.title",
		label: "页面标题",
		description: "触发通知的页面标题。",
		jsonSupported: true,
	},
	{
		path: "page.url",
		label: "页面 URL",
		description: "触发通知的公开页面地址。",
		jsonSupported: true,
	},
	{
		path: "comment.authorName",
		label: "评论作者",
		description: "触发通知的评论作者昵称。",
		jsonSupported: true,
	},
	{
		path: "comment.authorLabel",
		label: "评论作者展示名",
		description: "包含可信作者 Badge 的评论作者展示名。",
		jsonSupported: true,
	},
	{
		path: "comment.badgeLabel",
		label: "评论作者 Badge",
		description: "可信作者 Badge 文案；普通评论作者为空字符串。",
		jsonSupported: true,
	},
	{
		path: "comment.content",
		label: "评论内容",
		description: "触发通知的评论正文。",
		jsonSupported: true,
	},
	{
		path: "links.adminComment",
		label: "后台评论链接",
		description: "指向 Admin 评论详情或处理入口。",
		jsonSupported: true,
	},
	{
		path: "links.unsubscribe",
		label: "退订链接",
		description: "评论者通知退订地址，仅评论者订阅通知使用。",
		jsonSupported: true,
	},
	{
		path: "time.iso",
		label: "触发时间",
		description: "通知预览或触发时间的 ISO 字符串。",
		jsonSupported: true,
	},
];

const eventMetadata: Record<
	string,
	{
		label: string;
		description: string;
		triggerDescription: string;
		recipientType: string;
		placeholders: NotificationTemplatePlaceholder[];
	}
> = {
	admin_comment_pending: {
		label: "新评论待审核",
		description: "有新评论进入待审核队列时触发，面向站点管理人员。",
		triggerDescription: "评论提交后进入待审核状态时创建通知任务。",
		recipientType: "后台站点接收人",
		placeholders: commonPlaceholders.filter(
			(item) => item.path !== "links.unsubscribe",
		),
	},
	admin_comment_approved: {
		label: "评论已发布",
		description: "新评论直接发布时触发，面向站点管理人员。",
		triggerDescription: "评论提交后直接通过并发布时创建通知任务。",
		recipientType: "后台站点接收人",
		placeholders: commonPlaceholders.filter(
			(item) => item.path !== "links.unsubscribe",
		),
	},
	reply_approved: {
		label: "评论回复已通过",
		description: "评论者订阅的评论收到已审核回复时触发。",
		triggerDescription: "评论者订阅的评论出现已审核回复时创建通知任务。",
		recipientType: "评论订阅者",
		placeholders: [
			...commonPlaceholders,
			{
				path: "parent.authorName",
				label: "父评论作者",
				description: "被回复评论的作者昵称。",
				jsonSupported: true,
			},
			{
				path: "parent.content",
				label: "父评论内容",
				description: "被回复评论的正文。",
				jsonSupported: true,
			},
		],
	},
	channel_test: {
		label: "通知通道测试",
		description: "管理员手动测试通知通道时触发。",
		triggerDescription: "管理员从系统设置手动创建 channel_test 任务时使用。",
		recipientType: "测试收件人",
		placeholders: commonPlaceholders.filter((item) =>
			["site.name", "time.iso"].includes(item.path),
		),
	},
};

export const notificationTemplateFormatMetadata: Record<
	NotificationTemplateFormat,
	{ label: string }
> = {
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
		| "triggerDescription"
		| "recipientType"
		| "placeholders"
		| "formatLabel"
		| "supportsSubject"
	>,
): DefaultNotificationTemplate {
	return {
		...template,
		channelLabel: channelMetadata[template.channel].label,
		channelDescription: channelMetadata[template.channel].description,
		eventLabel: eventMetadata[template.eventType]?.label ?? template.eventType,
		eventDescription:
			eventMetadata[template.eventType]?.description ?? template.eventType,
		triggerDescription:
			eventMetadata[template.eventType]?.triggerDescription ??
			eventMetadata[template.eventType]?.description ??
			template.eventType,
		recipientType:
			eventMetadata[template.eventType]?.recipientType ?? "通知接收人",
		placeholders: eventMetadata[template.eventType]?.placeholders ?? [],
		formatLabel: notificationTemplateFormatMetadata[template.format].label,
		supportsSubject: template.subjectTemplate !== undefined,
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
			"{{comment.authorLabel}} 在 {{page.title}} 回复了你：\n{{comment.content}}\n\n查看页面：{{page.url}}\n\n如需退订可点击：{{links.unsubscribe}}",
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
			'<p>{{comment.authorLabel}} 在 {{page.title}} 回复了你：</p><blockquote>{{comment.content}}</blockquote><p><a href="{{page.url}}">查看页面</a></p><p>如需退订可点击：<a href="{{links.unsubscribe}}">退订评论回复提醒</a></p>',
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
