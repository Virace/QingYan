import { afterEach, describe, expect, it } from "vitest";

import {
	notificationDeliveries,
	notificationTemplates,
	taskRuns,
} from "../../src/db/schema";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin notification templates", () => {
	it("lists, updates, previews, restores defaults, and creates test tasks", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const auth = await loginAsAdmin(fixture.app);

		const listResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/notification-templates",
			cookies: {
				qingyan_admin: auth.adminCookie.value,
			},
		});
		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.json().templates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "commenter_reply_approved_email_text",
					name: "评论回复提醒 - 纯文本邮件",
					description: expect.stringContaining("评论者订阅"),
					channel: "email",
					channelLabel: "邮件",
					channelDescription: expect.stringContaining("SMTP"),
					eventType: "reply_approved",
					eventLabel: "评论回复已通过",
					eventDescription: expect.stringContaining("已审核回复"),
					format: "text",
					formatLabel: "纯文本",
					isCustomized: false,
				}),
				expect.objectContaining({
					key: "backend_comment_webhook_json",
					name: "新评论待审核 - Webhook JSON",
					channel: "webhook",
					channelLabel: "Webhook",
					eventType: "admin_comment_pending",
					eventLabel: "新评论待审核",
					format: "json",
					formatLabel: "JSON",
				}),
			]),
		);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/notification-templates/commenter_reply_approved_email_text",
			...withAdminWriteAuth(auth),
			payload: {
				format: "text",
				subjectTemplate: "[{{site.name}}] custom subject",
				bodyTemplate: "{{comment.authorName}} custom body",
			},
		});
		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json().template).toMatchObject({
			key: "commenter_reply_approved_email_text",
			name: "评论回复提醒 - 纯文本邮件",
			channelLabel: "邮件",
			eventLabel: "评论回复已通过",
			formatLabel: "纯文本",
			isCustomized: true,
			subjectTemplate: "[{{site.name}}] custom subject",
		});
		expect(
			await fixture.app.db.select().from(notificationTemplates),
		).toHaveLength(1);

		const previewResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/notification-templates/commenter_reply_approved_email_text/preview",
			...withAdminWriteAuth(auth),
			payload: {},
		});
		expect(previewResponse.statusCode).toBe(200);
		expect(previewResponse.json()).toMatchObject({
			rendered: {
				subject: "[FangYuan] custom subject",
				body: "Alice custom body",
			},
		});

		const testResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/notification-templates/commenter_reply_approved_email_text/test-send",
			...withAdminWriteAuth(auth),
			payload: {
				recipient: "template-test@example.test",
			},
		});
		expect(testResponse.statusCode).toBe(200);
		expect(testResponse.body).not.toContain("secret");
		expect(testResponse.json()).toMatchObject({
			taskId: expect.any(String),
			deliveryId: expect.any(String),
			queueBackend: "database",
			channel: "email",
			recipient: "template-test@example.test",
		});
		expect(await fixture.app.db.select().from(taskRuns)).toEqual([
			expect.objectContaining({
				type: "template_test",
				category: "notification",
			}),
		]);
		expect(await fixture.app.db.select().from(notificationDeliveries)).toEqual([
			expect.objectContaining({
				recipientType: "test",
				recipientAddressSnapshot: "template-test@example.test",
				eventFamily: "template_test",
			}),
		]);

		const restoreResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/notification-templates/commenter_reply_approved_email_text/restore-default",
			...withAdminWriteAuth(auth),
			payload: {},
		});
		expect(restoreResponse.statusCode).toBe(200);
		expect(restoreResponse.json().template).toMatchObject({
			key: "commenter_reply_approved_email_text",
			name: "评论回复提醒 - 纯文本邮件",
			eventLabel: "评论回复已通过",
			isCustomized: false,
		});
		expect(await fixture.app.db.select().from(notificationTemplates)).toEqual(
			[],
		);
	});
});
