import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	notificationChannelConfigs,
	siteNotificationRecipientRoutes,
	sites,
} from "../../src/db/schema";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import {
	type BackendUserNotificationEvent,
	BackendUserNotificationPlanner,
} from "../../src/modules/notifications/backend-user-notification-planner";
import { BackendUserNotificationPreferencesRepository } from "../../src/modules/notifications/backend-user-preferences-repository";
import { BackendUserNotificationRecipientsRepository } from "../../src/modules/notifications/backend-user-recipients-repository";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

type Fixture = Awaited<ReturnType<typeof createTestApp>>;

async function createUserWithSiteAccess(
	fixture: Fixture,
	input: {
		username: string;
		siteKey: string;
		email?: string;
		groupKey?: "site_admin" | "site_moderator" | "admin";
	},
) {
	const [site] = await fixture.app.db
		.select()
		.from(sites)
		.where(eq(sites.siteKey, input.siteKey));
	if (!site) {
		throw new Error(`Expected site ${input.siteKey} to exist`);
	}
	const [group] = await fixture.app.db
		.select()
		.from(adminGroups)
		.where(eq(adminGroups.key, input.groupKey ?? "site_moderator"));
	if (!group) {
		throw new Error("Expected group to exist");
	}

	await fixture.app.db.insert(adminUsers).values({
		username: input.username,
		email: input.email ?? `${input.username}@example.test`,
		passwordHash: createPasswordHash("replace-me"),
		displayName: input.username,
		status: "active",
	});
	const [user] = await fixture.app.db
		.select()
		.from(adminUsers)
		.where(eq(adminUsers.username, input.username));
	if (!user) {
		throw new Error(`Expected user ${input.username} to exist`);
	}

	await fixture.app.db.insert(adminUserGroups).values({
		userId: user.id,
		groupId: group.id,
	});
	await fixture.app.db.insert(adminUserSiteAccess).values({
		userId: user.id,
		siteId: site.id,
	});

	return { user, site };
}

async function createChannelConfig(
	fixture: Fixture,
	input: {
		id: string;
		type: "email" | "webhook" | "wxpusher";
		name: string;
		enabled?: boolean;
		config?: Record<string, unknown>;
		secretConfig?: Record<string, unknown>;
	},
) {
	await fixture.app.db.insert(notificationChannelConfigs).values({
		id: input.id,
		type: input.type,
		name: input.name,
		description: null,
		enabled: input.enabled ?? true,
		configJson: JSON.stringify(input.config ?? {}),
		secretConfigJson: JSON.stringify(input.secretConfig ?? {}),
	});
}

function commentEvent(
	override: Partial<BackendUserNotificationEvent> = {},
): BackendUserNotificationEvent {
	return {
		source: "public_api",
		siteId: 1,
		siteKey: "fangyuan",
		commentId: "comment-1",
		pageKey: "post:hello",
		status: "pending",
		previousStatus: null,
		authorUserId: null,
		verifiedAuthorEmail: "verified-author@example.test",
		contentRaw: "hello",
		createdAt: "2026-06-02T00:00:00.000Z",
		...override,
	};
}

describe("backend user notification preferences", () => {
	it("allows default email, honors pause, and keeps digest separate from channel allowance", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { user } = await createUserWithSiteAccess(fixture, {
			username: "preference-user",
			siteKey: "fangyuan",
		});
		const preferences = new BackendUserNotificationPreferencesRepository(
			fixture.app.db,
		);

		await expect(
			preferences.isChannelAllowedForUser({
				userId: user.id,
				channel: "email",
				now: new Date("2026-06-02T00:00:00.000Z"),
			}),
		).resolves.toBe(true);

		await preferences.updatePreference({
			userId: user.id,
			channel: "email",
			enabled: true,
			digestMode: "interval",
			digestIntervalMinutes: 60,
			pausedUntil: "2026-06-02T01:00:00.000Z",
		});
		await expect(
			preferences.isChannelAllowedForUser({
				userId: user.id,
				channel: "email",
				now: new Date("2026-06-02T00:30:00.000Z"),
			}),
		).resolves.toBe(false);
		await expect(
			preferences.isChannelAllowedForUser({
				userId: user.id,
				channel: "email",
				now: new Date("2026-06-02T01:01:00.000Z"),
			}),
		).resolves.toBe(true);
	});
});

describe("backend user notification planner", () => {
	it("plans pending and direct-approved admin notifications for configured site recipients", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { user, site } = await createUserWithSiteAccess(fixture, {
			username: "planner-recipient",
			siteKey: "fangyuan",
			email: "planner-recipient@example.test",
		});
		const recipients = new BackendUserNotificationRecipientsRepository(
			fixture.app.db,
		);
		await recipients.replaceSiteRecipients({
			siteId: site.id,
			recipients: [
				{
					userId: user.id,
					channels: ["email"],
					events: ["admin_comment_pending", "admin_comment_approved"],
					includeCommentContent: "summary",
					enabled: true,
				},
			],
		});
		const planner = new BackendUserNotificationPlanner(fixture.app.db);

		const pending = await planner.planForCommentEvent(
			commentEvent({ siteId: site.id, status: "pending" }),
		);
		expect(pending.tasks).toHaveLength(1);
		expect(pending.deliveries).toEqual([
			expect.objectContaining({
				recipientType: "backend_user",
				recipientUserId: user.id,
				recipientAddressSnapshot: "planner-recipient@example.test",
				channel: "email",
				eventFamily: "admin_comment_pending",
				event: "admin_comment_pending",
			}),
		]);

		const approved = await planner.planForCommentEvent(
			commentEvent({
				siteId: site.id,
				commentId: "comment-2",
				status: "approved",
			}),
		);
		expect(approved.deliveries).toEqual([
			expect.objectContaining({
				recipientUserId: user.id,
				eventFamily: "admin_comment_approved",
				event: "admin_comment_approved",
			}),
		]);
	});

	it("does not use verifiedAuthor.email and does not plan spam, imports, or pending-to-approved duplicates", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const planner = new BackendUserNotificationPlanner(fixture.app.db);

		await expect(
			planner.planForCommentEvent(
				commentEvent({
					status: "pending",
					verifiedAuthorEmail: "admin@example.test",
				}),
			),
		).resolves.toMatchObject({
			tasks: [],
			deliveries: [],
		});
		await expect(
			planner.planForCommentEvent(commentEvent({ status: "spam" })),
		).resolves.toMatchObject({
			tasks: [],
			deliveries: [],
		});
		await expect(
			planner.planForCommentEvent(commentEvent({ source: "import" })),
		).resolves.toMatchObject({
			tasks: [],
			deliveries: [],
		});
		await expect(
			planner.planForCommentEvent(
				commentEvent({
					status: "approved",
					previousStatus: "pending",
					source: "admin_moderation",
				}),
			),
		).resolves.toMatchObject({
			tasks: [],
			deliveries: [],
		});
	});

	it("plans digest tasks for backend users while leaving immediate channel allowance intact", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { user, site } = await createUserWithSiteAccess(fixture, {
			username: "digest-recipient",
			siteKey: "fangyuan",
		});
		const recipients = new BackendUserNotificationRecipientsRepository(
			fixture.app.db,
		);
		await recipients.replaceSiteRecipients({
			siteId: site.id,
			recipients: [
				{
					userId: user.id,
					channels: ["email"],
					events: ["admin_comment_pending"],
					includeCommentContent: "summary",
					enabled: true,
				},
			],
		});
		const preferences = new BackendUserNotificationPreferencesRepository(
			fixture.app.db,
		);
		await preferences.updatePreference({
			userId: user.id,
			channel: "email",
			enabled: true,
			digestMode: "interval",
			digestIntervalMinutes: 30,
		});

		const planner = new BackendUserNotificationPlanner(fixture.app.db);
		const planned = await planner.planForCommentEvent(
			commentEvent({ siteId: site.id }),
		);

		expect(planned.tasks).toEqual([
			expect.objectContaining({
				type: "backend_user_comment_digest",
				payloadSummary: expect.objectContaining({
					event: "admin_comment_pending",
					siteId: site.id,
					userId: user.id,
					eventCount: 1,
				}),
				payload: expect.objectContaining({
					event: "admin_comment_pending",
					siteId: site.id,
					userId: user.id,
					eventCount: 1,
					eventIds: ["comment-1"],
				}),
			}),
		]);
		expect(planned.deliveries).toHaveLength(0);
	});

	it("plans one delivery per selected concrete webhook and WxPusher config", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { user, site } = await createUserWithSiteAccess(fixture, {
			username: "multi-config-recipient",
			siteKey: "fangyuan",
			email: "multi-config@example.test",
		});
		await createChannelConfig(fixture, {
			id: "wxpusher:ops",
			type: "wxpusher",
			name: "运维 WxPusher",
			config: {
				targetSummary: "topic:ops",
				apiUrl: "https://wxpusher.example.test/api/send",
			},
			secretConfig: { appToken: "wxpusher-token-ops" },
		});
		await createChannelConfig(fixture, {
			id: "wxpusher:audit",
			type: "wxpusher",
			name: "审核 WxPusher",
			config: {
				targetSummary: "topic:audit",
				apiUrl: "https://wxpusher.example.test/api/send",
			},
			secretConfig: { appToken: "wxpusher-token-audit" },
		});
		await createChannelConfig(fixture, {
			id: "webhook:feishu",
			type: "webhook",
			name: "飞书 Webhook",
			config: {
				url: "https://hooks.example.test/qingyan?token=query-secret",
			},
			secretConfig: { secret: "webhook-secret" },
		});
		await createChannelConfig(fixture, {
			id: "webhook:disabled",
			type: "webhook",
			name: "停用 Webhook",
			enabled: false,
			config: {
				url: "https://disabled.example.test/qingyan",
			},
		});
		const recipients = new BackendUserNotificationRecipientsRepository(
			fixture.app.db,
		);
		const [recipient] = await recipients.replaceSiteRecipients({
			siteId: site.id,
			recipients: [
				{
					userId: user.id,
					routes: [
						{
							eventType: "admin_comment_pending",
							channelConfigId: "wxpusher:ops",
							enabled: true,
						},
						{
							eventType: "admin_comment_pending",
							channelConfigId: "wxpusher:audit",
							enabled: true,
						},
						{
							eventType: "admin_comment_pending",
							channelConfigId: "webhook:feishu",
							enabled: true,
						},
					],
					includeCommentContent: "summary",
					enabled: true,
				},
			],
		});
		await fixture.app.db.insert(siteNotificationRecipientRoutes).values({
			id: "route_disabled_webhook",
			recipientId: recipient.id,
			eventType: "admin_comment_pending",
			channelConfigId: "webhook:disabled",
			enabled: false,
		});

		const planner = new BackendUserNotificationPlanner(fixture.app.db);
		const planned = await planner.planForCommentEvent(
			commentEvent({
				siteId: site.id,
				commentId: "comment-multi-config",
				status: "pending",
			}),
		);

		expect(planned.tasks).toHaveLength(3);
		expect(planned.tasks.map((task) => task.idempotencyKey).sort()).toEqual([
			"backend_user_comment:comment-multi-config:" +
				user.id +
				":webhook:feishu:admin_comment_pending",
			"backend_user_comment:comment-multi-config:" +
				user.id +
				":wxpusher:audit:admin_comment_pending",
			"backend_user_comment:comment-multi-config:" +
				user.id +
				":wxpusher:ops:admin_comment_pending",
		]);
		expect(
			planned.deliveries.map((delivery) => ({
				channel: delivery.channel,
				channelConfigRef: delivery.channelConfigRef,
				channelConfigNameSnapshot: delivery.channelConfigNameSnapshot,
				recipientAddressSnapshot: delivery.recipientAddressSnapshot,
			})),
		).toEqual(
			expect.arrayContaining([
				{
					channel: "wxpusher",
					channelConfigRef: "wxpusher:ops",
					channelConfigNameSnapshot: "运维 WxPusher",
					recipientAddressSnapshot: "运维 WxPusher / topic:ops",
				},
				{
					channel: "wxpusher",
					channelConfigRef: "wxpusher:audit",
					channelConfigNameSnapshot: "审核 WxPusher",
					recipientAddressSnapshot: "审核 WxPusher / topic:audit",
				},
				{
					channel: "webhook",
					channelConfigRef: "webhook:feishu",
					channelConfigNameSnapshot: "飞书 Webhook",
					recipientAddressSnapshot: "https://hooks.example.test/qingyan",
				},
			]),
		);
		const serializedTasks = JSON.stringify(planned.tasks);
		expect(serializedTasks).not.toContain("wxpusher-token");
		expect(serializedTasks).not.toContain("webhook-secret");
		expect(serializedTasks).not.toContain("query-secret");
	});
});
