import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	auditLogs,
	commenterNotificationPreferences,
	comments,
	notificationChannelConfigs,
	notificationDeliveries,
	pageThreads,
	siteSettings,
	sites,
	taskRuns,
} from "../../src/db/schema";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { AdminRepository } from "../../src/modules/admin/repository";
import { AdminSystemSettingsRepository } from "../../src/modules/admin/system-settings-repository";
import { BackendUserNotificationRecipientsRepository } from "../../src/modules/notifications/backend-user-recipients-repository";
import { hashNotificationEmail } from "../../src/modules/notifications/email-address-policy";
import { NotificationChainTestService } from "../../src/modules/notifications/notification-chain-test-service";
import { NotificationDiagnosticsService } from "../../src/modules/notifications/notification-diagnostics-service";
import { NotificationTemplateContextBuilder } from "../../src/modules/notifications/notification-template-context";
import { NotificationWorker } from "../../src/modules/notifications/notification-worker";
import { DatabaseTaskQueue } from "../../src/modules/tasks/database-task-queue";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

type Fixture = Awaited<ReturnType<typeof createTestApp>>;

async function createScopedUser(
	fixture: Fixture,
	input: {
		username: string;
		groupKey: "site_admin" | "site_moderator";
		siteKeys: string[];
	},
) {
	const [group] = await fixture.app.db
		.select()
		.from(adminGroups)
		.where(eq(adminGroups.key, input.groupKey));
	if (!group) {
		throw new Error(`Expected group ${input.groupKey}.`);
	}
	await fixture.app.db.insert(adminUsers).values({
		username: input.username,
		email: `${input.username}@example.test`,
		passwordHash: createPasswordHash("replace-me"),
		displayName: input.username,
		status: "active",
	});
	const [user] = await fixture.app.db
		.select()
		.from(adminUsers)
		.where(eq(adminUsers.username, input.username));
	if (!user) {
		throw new Error(`Expected user ${input.username}.`);
	}
	await fixture.app.db.insert(adminUserGroups).values({
		userId: user.id,
		groupId: group.id,
	});
	for (const siteKey of input.siteKeys) {
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, siteKey));
		if (!site) {
			throw new Error(`Expected site ${siteKey}.`);
		}
		await fixture.app.db.insert(adminUserSiteAccess).values({
			userId: user.id,
			siteId: site.id,
		});
	}
}

async function createReadyContext(options?: {
	now?: () => Date;
	timeoutMs?: number;
	cooldownMs?: number;
}) {
	const fixture = await createTestApp();
	cleanups.push(fixture.cleanup);
	const [site] = await fixture.app.db
		.select()
		.from(sites)
		.where(eq(sites.siteKey, "fangyuan"));
	const [admin] = await fixture.app.db.select().from(adminUsers).limit(1);
	if (!site || !admin) {
		throw new Error("Expected seeded site and admin.");
	}
	await fixture.app.db
		.insert(adminUserSiteAccess)
		.values({ userId: admin.id, siteId: site.id })
		.onConflictDoNothing();
	await fixture.app.db
		.update(siteSettings)
		.set({
			commentsEnabled: true,
			defaultStatus: "pending",
			maxDepth: 3,
			commenterReplyEmailEnabled: true,
			backendNotificationsEnabled: true,
		})
		.where(eq(siteSettings.siteId, site.id));
	await fixture.app.db.insert(notificationChannelConfigs).values({
		id: "email:notification-chain-test",
		type: "email",
		name: "评论链路测试邮件",
		enabled: true,
		configJson: "{}",
		secretConfigJson: "{}",
	});
	await fixture.app.db.insert(notificationChannelConfigs).values({
		id: "webhook:must-not-run-in-chain-test",
		type: "webhook",
		name: "链路测试不得触发",
		enabled: true,
		configJson: JSON.stringify({ url: "https://hooks.example.test/qingyan" }),
		secretConfigJson: "{}",
	});
	await new BackendUserNotificationRecipientsRepository(
		fixture.app.db,
	).replaceSiteRecipients({
		siteId: site.id,
		recipients: [
			{
				userId: admin.id,
				routes: [
					{
						eventType: "admin_comment_pending",
						channelConfigId: "email:notification-chain-test",
						enabled: true,
					},
					{
						eventType: "admin_comment_approved",
						channelConfigId: "email:notification-chain-test",
						enabled: true,
					},
					{
						eventType: "admin_comment_pending",
						channelConfigId: "webhook:must-not-run-in-chain-test",
						enabled: true,
					},
				],
				includeCommentContent: "summary",
				enabled: true,
			},
		],
	});
	const systemSettings = new AdminSystemSettingsRepository(fixture.app.db);
	await systemSettings.upsert("mail", "enabled", true);
	await systemSettings.upsert("mail", "smtp.host", "smtp.example.test");
	await systemSettings.upsert("mail", "smtp.from", "notify@example.test");
	await systemSettings.upsert(
		"notifications",
		"delivery.queueBackend",
		"database",
	);
	const diagnostics = new NotificationDiagnosticsService(fixture.app.db, {
		notificationRuntimeState: () => ({
			started: true,
			running: false,
			lastTickAt: new Date().toISOString(),
			lastError: null,
		}),
		now: options?.now,
	});
	const service = new NotificationChainTestService(fixture.app.db, {
		diagnostics,
		now: options?.now,
		timeoutMs: options?.timeoutMs,
		cooldownMs: options?.cooldownMs,
	});
	return { fixture, site, admin, service };
}

describe("notification chain test orchestration", () => {
	it("queues both production email legs, aggregates provider acceptance, and cleans temporary data", async () => {
		const { fixture, site, admin, service } = await createReadyContext();

		const started = await service.start({
			siteKey: site.siteKey,
			commenterEmail: "Chain-Commenter@Example.COM",
			actorUserId: admin.id,
		});
		expect(started).toMatchObject({
			runId: expect.stringMatching(/^task_/u),
			status: "queued",
		});

		const runs = await fixture.app.db.select().from(taskRuns);
		expect(runs).toHaveLength(3);
		expect(runs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: started.runId,
					type: "notification_chain_test",
					status: "running",
				}),
				expect.objectContaining({
					type: "backend_user_comment_pending",
					category: "notification",
					status: "queued",
				}),
				expect.objectContaining({
					type: "reply_approved",
					category: "notification",
					status: "queued",
				}),
			]),
		);
		expect(await fixture.app.db.select().from(notificationDeliveries)).toEqual([
			expect.objectContaining({
				channel: "email",
				recipientType: "backend_user",
				recipientAddressSnapshot: admin.email,
			}),
			expect.objectContaining({
				channel: "email",
				recipientType: "commenter",
				recipientAddressSnapshot: "chain-commenter@example.com",
			}),
		]);
		expect(await fixture.app.db.select().from(pageThreads)).toEqual([
			expect.objectContaining({ kind: "notification_test" }),
		]);
		expect(await fixture.app.db.select().from(comments)).toHaveLength(2);
		expect(
			await fixture.app.db.select().from(commenterNotificationPreferences),
		).toEqual([
			expect.objectContaining({
				email: "chain-commenter@example.com",
				notifyOnReply: true,
				source: "notification_chain_test",
			}),
		]);

		const sent: Array<{ to: string; body: string }> = [];
		const worker = new NotificationWorker({
			queue: new DatabaseTaskQueue(fixture.app.db),
			repository: new TaskRunRepository(fixture.app.db),
			adapters: {
				email: {
					async send(input) {
						sent.push({ to: input.to, body: input.body });
						return { providerMessageId: `accepted-${sent.length}` };
					},
				},
			},
			templateContextBuilder: new NotificationTemplateContextBuilder(
				fixture.app.db,
				{
					publicBaseUrl: "http://localhost:4401",
					publicPath: "/qingyan",
				},
			),
		});
		expect(await worker.runNextNotificationTask({ limit: 10 })).toBe(2);

		const result = await service.get({
			siteKey: site.siteKey,
			runId: started.runId,
		});
		expect(result).toMatchObject({
			status: "passed",
			finishedAt: expect.any(String),
			flows: {
				adminComment: {
					status: "passed",
					deliveries: [
						expect.objectContaining({
							recipient: admin.email,
							status: "sent",
							providerMessageId: "accepted-1",
						}),
					],
				},
				commenterReply: {
					status: "passed",
					deliveries: [
						expect.objectContaining({
							recipient: "chain-commenter@example.com",
							status: "sent",
							providerMessageId: "accepted-2",
						}),
					],
				},
			},
		});
		expect(sent.map((message) => message.to)).toEqual([
			admin.email,
			"chain-commenter@example.com",
		]);
		expect(await fixture.app.db.select().from(pageThreads)).toEqual([]);
		expect(await fixture.app.db.select().from(comments)).toEqual([]);
		expect(
			await fixture.app.db.select().from(commenterNotificationPreferences),
		).toEqual([]);
		expect(
			await fixture.app.db.select().from(notificationDeliveries),
		).toHaveLength(2);
	});

	it("blocks before creating test data when diagnostics contain hard blockers", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const [admin] = await fixture.app.db.select().from(adminUsers).limit(1);
		if (!admin) {
			throw new Error("Expected seeded admin.");
		}
		const service = new NotificationChainTestService(fixture.app.db);

		await expect(
			service.start({
				siteKey: "fangyuan",
				commenterEmail: "blocked@example.com",
				actorUserId: admin.id,
			}),
		).rejects.toMatchObject({
			code: "NOTIFICATION_CHAIN_TEST_BLOCKED",
			details: {
				blockers: expect.arrayContaining([
					expect.objectContaining({ code: "system_mail_disabled" }),
				]),
			},
		});
		expect(await fixture.app.db.select().from(taskRuns)).toEqual([]);
		expect(await fixture.app.db.select().from(pageThreads)).toEqual([]);
		expect(await fixture.app.db.select().from(comments)).toEqual([]);
	});

	it("rejects a second active run and enforces cooldown after completion", async () => {
		const { fixture, site, admin, service } = await createReadyContext({
			cooldownMs: 60_000,
		});
		const first = await service.start({
			siteKey: site.siteKey,
			commenterEmail: "active@example.com",
			actorUserId: admin.id,
		});
		await expect(
			service.start({
				siteKey: site.siteKey,
				commenterEmail: "second@example.com",
				actorUserId: admin.id,
			}),
		).rejects.toMatchObject({
			code: "NOTIFICATION_CHAIN_TEST_ACTIVE",
		});

		const repository = new TaskRunRepository(fixture.app.db);
		const parent = await repository.getRequired(first.runId);
		const progress = parent.progress as {
			adminTaskIds: string[];
			commenterTaskIds: string[];
		};
		for (const taskId of [
			...progress.adminTaskIds,
			...progress.commenterTaskIds,
		]) {
			const deliveries = await repository.listDeliveriesForTask(taskId);
			for (const delivery of deliveries) {
				await repository.markDeliverySent({ id: delivery.id });
			}
			await repository.markSucceeded(taskId, { sent: deliveries.length });
		}
		expect(
			await service.get({ siteKey: site.siteKey, runId: first.runId }),
		).toMatchObject({ status: "passed" });
		await expect(
			service.start({
				siteKey: site.siteKey,
				commenterEmail: "cooldown@example.com",
				actorUserId: admin.id,
			}),
		).rejects.toMatchObject({
			code: "NOTIFICATION_CHAIN_TEST_COOLDOWN",
		});
	});

	it("times out queued children, restores the previous preference, and cleans internal comments", async () => {
		let current = new Date("2026-07-26T10:00:00.000Z");
		const { fixture, site, admin, service } = await createReadyContext({
			now: () => current,
			timeoutMs: 60_000,
			cooldownMs: 0,
		});
		const emailHash = hashNotificationEmail("timeout@example.com");
		if (!emailHash) {
			throw new Error("Expected a notification email hash.");
		}
		await fixture.app.db.insert(commenterNotificationPreferences).values({
			id: "existing_chain_preference",
			siteId: site.id,
			email: "timeout@example.com",
			emailHash,
			notifyOnReply: false,
			source: "comment_form",
			createdAt: "2026-07-20T00:00:00.000Z",
			updatedAt: "2026-07-20T00:00:00.000Z",
		});
		const started = await service.start({
			siteKey: site.siteKey,
			commenterEmail: "timeout@example.com",
			actorUserId: admin.id,
		});
		current = new Date("2026-07-26T10:02:00.000Z");

		expect(
			await service.get({ siteKey: site.siteKey, runId: started.runId }),
		).toMatchObject({ status: "timed_out" });
		expect(await fixture.app.db.select().from(pageThreads)).toEqual([]);
		expect(await fixture.app.db.select().from(comments)).toEqual([]);
		expect(
			await fixture.app.db.select().from(commenterNotificationPreferences),
		).toEqual([
			expect.objectContaining({
				id: "existing_chain_preference",
				notifyOnReply: false,
				source: "comment_form",
				updatedAt: "2026-07-20T00:00:00.000Z",
			}),
		]);
		const childRuns = (await fixture.app.db.select().from(taskRuns)).filter(
			(run) => run.id !== started.runId,
		);
		expect(childRuns.every((run) => run.status === "cancelled")).toBe(true);
	});

	it("reconciles a stale interrupted run before starting the next test", async () => {
		let current = new Date();
		const { fixture, site, admin, service } = await createReadyContext({
			now: () => current,
			timeoutMs: 60_000,
			cooldownMs: 0,
		});
		const first = await service.start({
			siteKey: site.siteKey,
			commenterEmail: "stale-first@example.com",
			actorUserId: admin.id,
		});
		const firstParent = await new TaskRunRepository(fixture.app.db).getRequired(
			first.runId,
		);
		const firstProgress = firstParent.progress as { pageKey: string };
		current = new Date(current.getTime() + 120_000);

		const second = await service.start({
			siteKey: site.siteKey,
			commenterEmail: "stale-second@example.com",
			actorUserId: admin.id,
		});

		expect(second.status).toBe("queued");
		expect(
			await new TaskRunRepository(fixture.app.db).getRequired(first.runId),
		).toMatchObject({
			status: "failed",
			error: expect.objectContaining({
				code: "notification_chain_test_timed_out",
			}),
		});
		const internalThreads = await fixture.app.db.select().from(pageThreads);
		expect(internalThreads).toHaveLength(1);
		expect(internalThreads[0]?.pageKey).not.toBe(firstProgress.pageKey);
	});
});

describe("admin notification chain test API", () => {
	it("requires session, site access, and matching settings permissions", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const unauthenticated = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/sites/fangyuan/notification-chain-tests",
			payload: { commenterEmail: "chain@example.com" },
		});
		expect(unauthenticated.statusCode).toBe(401);

		await new AdminRepository(fixture.app.db).createSite({
			siteKey: "qingyan",
			name: "QingYan",
			allowedOrigins: ["http://localhost:4322"],
		});
		await fixture.app.siteRegistry.loadFromDatabase(fixture.app.db);
		await createScopedUser(fixture, {
			username: "chain-other-site",
			groupKey: "site_admin",
			siteKeys: ["qingyan"],
		});
		await createScopedUser(fixture, {
			username: "chain-moderator",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
		});

		const otherSiteAuth = await loginAsAdmin(fixture.app, {
			username: "chain-other-site",
			password: "replace-me",
		});
		const siteDenied = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/sites/fangyuan/notification-chain-tests",
			...withAdminWriteAuth(otherSiteAuth),
			payload: { commenterEmail: "chain@example.com" },
		});
		expect(siteDenied.statusCode).toBe(403);
		expect(siteDenied.json()).toMatchObject({
			error: { code: "ADMIN_SITE_ACCESS_REQUIRED" },
		});

		const moderatorAuth = await loginAsAdmin(fixture.app, {
			username: "chain-moderator",
			password: "replace-me",
		});
		const updateDenied = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/sites/fangyuan/notification-chain-tests",
			...withAdminWriteAuth(moderatorAuth),
			payload: { commenterEmail: "chain@example.com" },
		});
		expect(updateDenied.statusCode).toBe(403);
		expect(updateDenied.json()).toMatchObject({
			error: { code: "ADMIN_PERMISSION_REQUIRED" },
		});
		const readDenied = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/fangyuan/notification-chain-tests/task_missing",
			cookies: {
				qingyan_admin: moderatorAuth.adminCookie.value,
			},
		});
		expect(readDenied.statusCode).toBe(403);
		expect(readDenied.json()).toMatchObject({
			error: { code: "ADMIN_PERMISSION_REQUIRED" },
		});
	});

	it("validates the commenter email before creating a run", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const auth = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/sites/fangyuan/notification-chain-tests",
			...withAdminWriteAuth(auth),
			payload: { commenterEmail: "not-an-email" },
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: { code: "VALIDATION_FAILED" },
		});
		expect(await fixture.app.db.select().from(taskRuns)).toEqual([]);
	});

	it("starts, polls, and audits a real provider-backed test through the Admin API", async () => {
		const { fixture, site } = await createReadyContext();
		const auth = await loginAsAdmin(fixture.app);
		fixture.app.notificationRuntime.start();
		expect(await fixture.app.notificationRuntime.tick()).toBe(0);

		const start = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/sites/${site.siteKey}/notification-chain-tests`,
			...withAdminWriteAuth(auth),
			payload: { commenterEmail: "api-chain@example.com" },
		});
		expect(start.statusCode, JSON.stringify(start.json())).toBe(200);
		expect(start.json()).toMatchObject({
			runId: expect.stringMatching(/^task_/u),
			status: "queued",
		});

		expect(await fixture.app.notificationRuntime.tick()).toBe(2);
		const result = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/api/admin/sites/${site.siteKey}/notification-chain-tests/${start.json().runId}`,
			cookies: {
				qingyan_admin: auth.adminCookie.value,
			},
		});
		expect(result.statusCode).toBe(200);
		expect(result.json()).toMatchObject({
			status: "passed",
			flows: {
				adminComment: { status: "passed" },
				commenterReply: { status: "passed" },
			},
		});
		expect(await fixture.app.db.select().from(comments)).toEqual([]);
		expect(await fixture.app.db.select().from(pageThreads)).toEqual([]);
		expect(await fixture.app.db.select().from(auditLogs)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					action: "notification.chain_test.started",
					targetId: start.json().runId,
				}),
				expect.objectContaining({
					action: "notification.chain_test.completed",
					targetId: start.json().runId,
				}),
			]),
		);
	});

	it("audits one safe failed terminal result", async () => {
		const { fixture, site } = await createReadyContext();
		const auth = await loginAsAdmin(fixture.app);
		fixture.app.notificationRuntime.start();
		await fixture.app.notificationRuntime.tick();
		const start = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/sites/${site.siteKey}/notification-chain-tests`,
			...withAdminWriteAuth(auth),
			payload: { commenterEmail: "api-failure@example.com" },
		});
		expect(start.statusCode, JSON.stringify(start.json())).toBe(200);

		const repository = new TaskRunRepository(fixture.app.db);
		const parent = await repository.getRequired(start.json().runId);
		const progress = parent.progress as {
			adminTaskIds: string[];
			commenterTaskIds: string[];
		};
		for (const taskId of [
			...progress.adminTaskIds,
			...progress.commenterTaskIds,
		]) {
			for (const delivery of await repository.listDeliveriesForTask(taskId)) {
				await repository.markDeliveryFailed({
					id: delivery.id,
					error: {
						kind: "configuration",
						message: "测试投递配置失败。",
					},
				});
			}
			await repository.markFailed(taskId, {
				kind: "configuration",
				message: "测试投递配置失败。",
			});
		}

		const poll = async () =>
			fixture.app.inject({
				method: "GET",
				url: `/qingyan/api/admin/sites/${site.siteKey}/notification-chain-tests/${start.json().runId}`,
				cookies: {
					qingyan_admin: auth.adminCookie.value,
				},
			});
		const failed = await poll();
		expect(failed.statusCode).toBe(200);
		expect(failed.json()).toMatchObject({
			status: "failed",
			flows: {
				adminComment: {
					status: "failed",
					deliveries: [
						expect.objectContaining({
							error: {
								kind: "configuration",
								message: "测试投递配置失败。",
							},
						}),
					],
				},
				commenterReply: { status: "failed" },
			},
		});
		await poll();
		const failedAudits = (await fixture.app.db.select().from(auditLogs)).filter(
			(audit) =>
				audit.action === "notification.chain_test.failed" &&
				audit.targetId === start.json().runId,
		);
		expect(failedAudits).toHaveLength(1);
		expect(failedAudits[0]?.payloadJson).not.toContain(
			"api-failure@example.com",
		);
	});
});
