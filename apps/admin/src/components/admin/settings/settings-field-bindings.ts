export type SettingsFieldBinding = {
	path: string;
	groupId: string;
	controlId: string;
	label: string;
};

export const siteSettingsFieldBindings = [
	{
		path: "comments.enabled",
		groupId: "comments",
		controlId: "comments-enabled",
		label: "评论",
	},
	{
		path: "comments.captcha.mode",
		groupId: "comments-captcha",
		controlId: "comments-captcha-mode",
		label: "评论验证码模式",
	},
	{
		path: "engagement.commentVotes.enabled",
		groupId: "comments",
		controlId: "comment-votes-enabled",
		label: "评论投票",
	},
	{
		path: "engagement.pageViews.enabled",
		groupId: "page-feedback",
		controlId: "page-views-enabled",
		label: "页面浏览量",
	},
	{
		path: "engagement.pageLikes.enabled",
		groupId: "page-feedback",
		controlId: "page-likes-enabled",
		label: "页面点赞",
	},
	{
		path: "engagement.visitors.enabled",
		groupId: "visitors",
		controlId: "visitors-enabled",
		label: "访客记录",
	},
	{
		path: "notifications.commenter.replyEmailEnabled",
		groupId: "site-notifications",
		controlId: "commenter-reply-email-notifications",
		label: "评论者回复邮件通知",
	},
	{
		path: "notifications.commenter.replyEmailDefaultChecked",
		groupId: "site-notifications",
		controlId: "commenter-reply-email-default-checked",
		label: "回复提醒默认勾选",
	},
	{
		path: "notifications.backend.enabled",
		groupId: "site-notifications",
		controlId: "backend-user-notifications",
		label: "后台用户通知",
	},
] satisfies SettingsFieldBinding[];

export const systemSettingsFieldBindings = [
	{
		path: "mail.enabled",
		groupId: "system-mail",
		controlId: "system-mail-enabled",
		label: "系统邮件",
	},
	{
		path: "mail.smtp.port",
		groupId: "system-mail",
		controlId: "smtp-port",
		label: "SMTP Port",
	},
	{
		path: "avatar.external.enabled",
		groupId: "avatar",
		controlId: "external-avatar-enabled",
		label: "外部头像 URL",
	},
	{
		path: "publicApi.advisoryFields.enabled",
		groupId: "public-api",
		controlId: "public-api-advisory-fields",
		label: "返回建议字段",
	},
] satisfies SettingsFieldBinding[];
