import type { TaskRunRepository } from "../../tasks/task-run-repository";
import {
	renderNotificationTemplate,
	type NotificationTemplateFormat,
} from "./renderer";
import type {
	NotificationTemplateRepository,
	NotificationTemplateRecord,
} from "./repository";

function previewContext() {
	return {
		site: { name: "FangYuan", key: "fangyuan" },
		page: {
			title: "示例文章",
			url: "https://fangyuan.example.test/posts/example",
		},
		comment: {
			authorName: "Alice",
			authorLabel: "Alice",
			badgeLabel: "",
			content: "这是一条用于模板预览的评论。",
			contentNote: "正文摘要",
			authorEmail: "alice@example.test",
			authorWebsite: "未提供",
			authorIdentity: "访客",
			status: "待审核",
		},
		parent: {
			authorName: "Bob",
			content: "这是一条父级评论。",
		},
		links: {
			adminComment: "https://qingyan.example.test/admin/comments/comment_1",
			unsubscribe:
				"https://qingyan.example.test/notifications/unsubscribe?token=preview",
		},
		moderation: {
			verdict: "未识别为垃圾",
			reason: "本站采用人工审核，等待站点人员处理。",
		},
		request: {
			ip: "192.0.2.1",
			device: "Firefox / Windows",
			userAgent: "示例浏览器",
		},
		time: {
			iso: new Date("2026-06-02T10:00:00.000Z").toISOString(),
			display: "2026-06-02 10:00:00 UTC",
		},
	};
}

export class NotificationTemplateAdminService {
	public constructor(
		private readonly templates: NotificationTemplateRepository,
		private readonly tasks: TaskRunRepository,
	) {}

	public list() {
		return this.templates.list();
	}

	public async update(input: {
		key: string;
		format: NotificationTemplateFormat;
		subjectTemplate?: string | null;
		bodyTemplate: string;
		updatedByUserId: number;
	}) {
		return this.templates.upsert(input);
	}

	public async preview(input: {
		key: string;
		format?: NotificationTemplateFormat;
		subjectTemplate?: string | null;
		bodyTemplate?: string;
	}) {
		const template = await this.templates.get(input.key);
		if (!template) {
			return null;
		}
		return renderTemplate({
			...template,
			format: input.format ?? template.format,
			subjectTemplate:
				input.subjectTemplate === undefined
					? template.subjectTemplate
					: input.subjectTemplate,
			bodyTemplate: input.bodyTemplate ?? template.bodyTemplate,
		});
	}

	public restoreDefault(key: string) {
		return this.templates.restoreDefault(key);
	}

	public async test(input: {
		key: string;
		recipient: string;
		actorUserId: number;
	}) {
		const template = await this.templates.get(input.key);
		if (!template) {
			return null;
		}
		const rendered = renderTemplate(template);
		const task = await this.tasks.create({
			type: "template_test",
			category: "notification",
			actorType: "admin_user",
			actorId: String(input.actorUserId),
			payloadSummary: {
				eventFamily: "template_test",
				channel: template.channel,
				recipientType: "test",
				recipientAddressSnapshot: input.recipient,
				templateKey: input.key,
			},
			payload: {
				templateKey: input.key,
				channel: template.channel,
				format: template.format,
				subjectTemplate: template.subjectTemplate,
				bodyTemplate: template.bodyTemplate,
				templateContext: previewContext(),
			},
			maxAttempts: 1,
		});
		const delivery = await this.tasks.createDelivery({
			taskRunId: task.id,
			channel: template.channel,
			recipientType: "test",
			recipientUserId: input.actorUserId,
			recipientAddressSnapshot: input.recipient,
			recipientIdentityKey: input.recipient,
			eventFamily: "template_test",
			templateKey: input.key,
		});
		return {
			taskId: task.id,
			deliveryId: delivery.id,
			queueBackend: task.queueBackend,
			channel: template.channel,
			recipient: input.recipient,
			preview: rendered,
		};
	}
}

function renderTemplate(
	template: Pick<
		NotificationTemplateRecord,
		"format" | "subjectTemplate" | "bodyTemplate"
	>,
) {
	return renderNotificationTemplate({
		format: template.format,
		subjectTemplate: template.subjectTemplate,
		bodyTemplate: template.bodyTemplate,
		context: previewContext(),
	});
}
