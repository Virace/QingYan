import { afterEach, describe, expect, it } from "vitest";

import {
	adminUsers,
	notificationChannelConfigs,
	notificationDeliveries,
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

describe("admin notification channel test", () => {
	it("uses current user's email as default recipient and does not expose secrets", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const update = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				logging: { level: "info", retentionDays: 7 },
				mail: {
					enabled: true,
					smtp: {
						host: "smtp.example.test",
						port: 587,
						secure: false,
						username: "notify@example.test",
						password: "smtp-secret",
						from: "notify@example.test",
					},
				},
				notifications: {
					webhook: {
						enabled: true,
						url: "https://webhook.example.test/qingyan",
						secret: "webhook-secret",
					},
					wxpusher: {
						enabled: true,
						appToken: "wxpusher-token",
					},
				},
			},
		});
		expect(update.statusCode).toBe(200);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/system-settings/notifications/channel-test",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: { channelConfigId: "email:default", siteKey: "default" },
		});

		expect(response.statusCode).toBe(200);
		expect(response.body).not.toContain("smtp-secret");
		expect(response.body).not.toContain("webhook-secret");
		expect(response.body).not.toContain("wxpusher-token");
		const body = response.json();
		expect(body).toMatchObject({
			taskId: expect.any(String),
			deliveryId: expect.any(String),
			queueBackend: "database",
			channelConfigId: "email:default",
			channelType: "email",
			channelName: "默认邮件",
		});
		const [admin] = await fixture.app.db.select().from(adminUsers).limit(1);
		expect(await fixture.app.db.select().from(notificationDeliveries)).toEqual([
			expect.objectContaining({
				id: body.deliveryId,
				recipientType: "test",
				recipientUserId: admin?.id,
				recipientAddressSnapshot: admin?.email,
				channel: "email",
				channelConfigRef: "email:default",
				channelConfigNameSnapshot: "默认邮件",
			}),
		]);
		const [task] = await fixture.app.db.select().from(taskRuns);
		expect(task).toMatchObject({
			id: body.taskId,
			siteKey: "default",
		});
	});

	it("tests a concrete webhook config and keeps secret values out of response and task payload", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		await fixture.app.db.insert(notificationChannelConfigs).values({
			id: "webhook:ops",
			type: "webhook",
			name: "运维 Webhook",
			description: null,
			enabled: true,
			configJson: JSON.stringify({
				url: "https://hooks.example.test/qingyan?token=query-secret",
			}),
			secretConfigJson: JSON.stringify({ secret: "webhook-secret" }),
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/system-settings/notifications/channel-test",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				channelConfigId: "webhook:ops",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.body).not.toContain("webhook-secret");
		expect(response.body).not.toContain("query-secret");
		expect(response.json()).toMatchObject({
			channelConfigId: "webhook:ops",
			channelType: "webhook",
			channelName: "运维 Webhook",
			recipient: "https://hooks.example.test/qingyan",
		});
		const [task] = await fixture.app.db.select().from(taskRuns);
		expect(task).toMatchObject({
			category: "notification",
			type: "channel_test",
			status: "queued",
		});
		expect(task?.payloadJson).not.toContain("webhook-secret");
		expect(task?.payloadJson).not.toContain("query-secret");
		expect(task?.payloadSummaryJson).not.toContain("webhook-secret");
		expect(task?.payloadSummaryJson).not.toContain("query-secret");
	});
});
