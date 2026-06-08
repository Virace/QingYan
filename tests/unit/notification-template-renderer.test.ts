import { describe, expect, it } from "vitest";

import {
	NotificationTemplateError,
	renderNotificationTemplate,
} from "../../src/modules/notifications/templates/renderer";

const context = {
	site: {
		name: "FangYuan",
		key: "fangyuan",
	},
	page: {
		title: "Hello",
		url: "https://fangyuan.example.test/posts/hello",
	},
	comment: {
		authorName: "Alice",
		content: "<script>alert(1)</script>",
	},
	parent: {
		authorName: "Bob",
		content: "Parent comment",
	},
	links: {
		adminComment: "https://qingyan.example.test/admin/comments/c1",
		unsubscribe:
			"https://qingyan.example.test/notifications/unsubscribe?t=token",
	},
	time: {
		iso: "2026-06-02T10:00:00.000Z",
	},
};

describe("notification template renderer", () => {
	it("escapes comment content in html templates", () => {
		const rendered = renderNotificationTemplate({
			format: "html",
			subjectTemplate: "Reply from {{comment.authorName}}",
			bodyTemplate: "<p>{{comment.content}}</p>",
			context,
		});

		expect(rendered.subject).toBe("Reply from Alice");
		expect(rendered.body).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
	});

	it("preserves readable text content and strips header injection from subjects", () => {
		const rendered = renderNotificationTemplate({
			format: "text",
			subjectTemplate: "Reply\r\nBcc: attacker@example.test",
			bodyTemplate: "{{site.name}}: {{comment.content}}",
			context,
		});

		expect(rendered.subject).toBe("Reply Bcc: attacker@example.test");
		expect(rendered.body).toBe("FangYuan: <script>alert(1)</script>");
	});

	it("validates rendered json templates", () => {
		const rendered = renderNotificationTemplate({
			format: "json",
			bodyTemplate:
				'{"site":"{{site.key}}","content":{{json comment.content}}}',
			context,
		});

		expect(JSON.parse(rendered.body)).toEqual({
			site: "fangyuan",
			content: "<script>alert(1)</script>",
		});
	});

	it("throws template errors for invalid json and missing variables", () => {
		expect(() =>
			renderNotificationTemplate({
				format: "json",
				bodyTemplate: '{"content":"{{comment.content}}"} trailing',
				context,
			}),
		).toThrow(NotificationTemplateError);

		expect(() =>
			renderNotificationTemplate({
				format: "text",
				bodyTemplate: "{{comment.missing}}",
				context,
			}),
		).toThrow(NotificationTemplateError);
	});
});
