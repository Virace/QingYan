import { afterEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";

import {
	commenterNotificationPreferences,
	comments,
	pageThreads,
	siteSettings,
	sites,
	taskRuns,
	unsubscribeTokens,
} from "../../src/db/schema";
import { DatabaseTaskQueue } from "../../src/modules/tasks/database-task-queue";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import { NotificationWorker } from "../../src/modules/notifications/notification-worker";
import { NotificationChannelError } from "../../src/modules/notifications/channels/error-classifier";
import { hashNotificationEmail } from "../../src/modules/notifications/email-address-policy";
import { NotificationTemplateContextBuilder } from "../../src/modules/notifications/notification-template-context";
import { CommenterPreferencesRepository } from "../../src/modules/notifications/commenter-preferences-repository";
import { UnsubscribeTokenService } from "../../src/modules/notifications/unsubscribe-token-service";
import { serializeVerifiedAuthorSettings } from "../../src/modules/comments/verified-author";
import type { AppDatabase } from "../../src/db/client";
import { createDatabaseClients } from "../../src/db/client";
import {
	applyInitialMigration,
	createTestApp,
	createTestConfig,
	createTestWorkspace,
} from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

async function createQueuedTask(
	repository: TaskRunRepository,
	input?: {
		recipientType?: "backend_user" | "commenter";
		recipientAddress?: string;
		maxAttempts?: number;
	},
) {
	const task = await repository.create({
		queueBackend: "database",
		type: "channel_test",
		category: "notification",
		payload: {
			templateContext: {
				site: { name: "FangYuan" },
				comment: { content: "hello" },
			},
		},
		payloadSummary: { channel: "email" },
		maxAttempts: input?.maxAttempts ?? 2,
	});
	const delivery = await repository.createDelivery({
		taskRunId: task.id,
		channel: "email",
		recipientType: input?.recipientType ?? "backend_user",
		recipientAddressSnapshot:
			input?.recipientAddress ?? "recipient@example.test",
		recipientIdentityKey: input?.recipientAddress ?? "recipient@example.test",
		eventFamily: "channel_test",
		templateKey: "channel_test",
	});
	return { task, delivery };
}

async function createQueuedCommenterReplyTask(
	db: AppDatabase,
	repository: TaskRunRepository,
) {
	const [site] = await db
		.select()
		.from(sites)
		.where(eq(sites.siteKey, "fangyuan"))
		.limit(1);
	const resolvedSite =
		site ??
		(
			await db
				.insert(sites)
				.values({
					siteKey: "fangyuan",
					name: "FangYuan",
					allowedOriginsJson: JSON.stringify(["http://localhost:4321"]),
				})
				.returning()
		)[0];
	if (!resolvedSite) {
		throw new Error("Expected fangyuan test site to exist");
	}
	await db
		.insert(siteSettings)
		.values({
			siteId: resolvedSite.id,
			verifiedAuthorJson: serializeVerifiedAuthorSettings({
				enabled: true,
				displayName: "Reply",
				email: "reply@example.com",
				website: "",
				badgeLabel: "楼主",
			}),
		})
		.onConflictDoUpdate({
			target: siteSettings.siteId,
			set: {
				verifiedAuthorJson: serializeVerifiedAuthorSettings({
					enabled: true,
					displayName: "Reply",
					email: "reply@example.com",
					website: "",
					badgeLabel: "楼主",
				}),
			},
		});
	const [thread] = await db
		.insert(pageThreads)
		.values({
			siteId: resolvedSite.id,
			pageKey: "/posts/worker-reply/",
			pageTitle: "Worker Reply",
			pageUrl: "/posts/worker-reply/",
			commentCount: 2,
			rootCommentCount: 1,
		})
		.returning();
	await db.insert(comments).values([
		{
			id: "c_worker_parent",
			siteId: resolvedSite.id,
			pageThreadId: thread.id,
			status: "approved",
			authorName: "Parent",
			authorEmail: "parent@example.com",
			authorEmailHash: hashNotificationEmail("parent@example.com"),
			contentRaw: "parent content",
			contentHtml: "<p>parent content</p>",
		},
		{
			id: "c_worker_reply",
			siteId: resolvedSite.id,
			pageThreadId: thread.id,
			parentId: "c_worker_parent",
			status: "approved",
			authorIdentity: "verified",
			authorName: "Reply",
			authorEmail: "reply@example.com",
			contentRaw: "reply content",
			contentHtml: "<p>reply content</p>",
		},
	]);
	await db.insert(commenterNotificationPreferences).values({
		id: "pref_worker_parent",
		siteId: resolvedSite.id,
		email: "parent@example.com",
		emailHash: hashNotificationEmail("parent@example.com") ?? "",
		notifyOnReply: true,
		source: "comment_form",
	});
	const task = await repository.create({
		queueBackend: "database",
		type: "reply_approved",
		category: "notification",
		siteId: resolvedSite.id,
		siteKey: "fangyuan",
		subjectType: "comment",
		subjectId: "c_worker_reply",
		payload: {
			event: "reply_approved",
			parentCommentId: "c_worker_parent",
			replyCommentId: "c_worker_reply",
			subjectTemplate: "[QingYan] {{comment.authorName}} replied",
			format: "text",
		},
		payloadSummary: { channel: "email", recipientType: "commenter" },
		maxAttempts: 2,
	});
	const delivery = await repository.createDelivery({
		taskRunId: task.id,
		channel: "email",
		recipientType: "commenter",
		recipientAddressSnapshot: "parent@example.com",
		recipientIdentityKey: hashNotificationEmail("parent@example.com") ?? "",
		eventFamily: "reply_approved",
		templateKey: "commenter.reply_approved",
	});
	return { task, delivery };
}

describe("notification worker", () => {
	it("marks successful email task and delivery as sent", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const repository = new TaskRunRepository(fixture.app.db);
		const { task, delivery } = await createQueuedTask(repository);
		const send = vi.fn(async () => ({ providerMessageId: "smtp-1" }));
		const worker = new NotificationWorker({
			queue: new DatabaseTaskQueue(fixture.app.db),
			repository,
			adapters: { email: { send } },
		});

		const processed = await worker.runNextNotificationTask({ limit: 1 });

		expect(processed).toBe(1);
		await expect(repository.getRequired(task.id)).resolves.toMatchObject({
			status: "succeeded",
			result: { sent: 1, failed: 0 },
		});
		await expect(
			repository.getDeliveryRequired(delivery.id),
		).resolves.toMatchObject({
			status: "sent",
			providerMessageId: "smtp-1",
		});
	});

	it("retries temporary failures with runAfter", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const repository = new TaskRunRepository(fixture.app.db);
		const { task } = await createQueuedTask(repository, { maxAttempts: 3 });
		const worker = new NotificationWorker({
			queue: new DatabaseTaskQueue(fixture.app.db),
			repository,
			adapters: {
				email: {
					send: async () => {
						throw new NotificationChannelError("temporary", "timeout");
					},
				},
			},
			retryDelaySec: 60,
		});

		await worker.runNextNotificationTask({
			limit: 1,
			now: new Date("2026-06-02T10:00:00.000Z"),
		});

		await expect(repository.getRequired(task.id)).resolves.toMatchObject({
			status: "retrying",
			attempts: 1,
			runAfter: "2026-06-02T10:01:00.000Z",
		});
	});

	it("does not update reputation for config errors or backend-user recipient failures", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const repository = new TaskRunRepository(fixture.app.db);
		await createQueuedTask(repository, { recipientType: "backend_user" });
		const reputation = {
			recordRecipientFailure: vi.fn(),
			recordSuccess: vi.fn(),
		};
		const worker = new NotificationWorker({
			queue: new DatabaseTaskQueue(fixture.app.db),
			repository,
			adapters: {
				email: {
					send: async () => {
						throw new NotificationChannelError("config", "missing smtp");
					},
				},
			},
			reputation,
		});

		await worker.runNextNotificationTask({ limit: 1 });

		expect(reputation.recordRecipientFailure).not.toHaveBeenCalled();
		expect(await fixture.app.db.select().from(taskRuns)).toEqual([
			expect.objectContaining({ status: "failed" }),
		]);
	});

	it("increments reputation only for commenter recipient failures", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const repository = new TaskRunRepository(fixture.app.db);
		const { task } = await createQueuedTask(repository, {
			recipientType: "commenter",
			recipientAddress: "commenter@example.test",
		});
		const reputation = {
			recordRecipientFailure: vi.fn(),
			recordSuccess: vi.fn(),
		};
		const worker = new NotificationWorker({
			queue: new DatabaseTaskQueue(fixture.app.db),
			repository,
			adapters: {
				email: {
					send: async () => {
						throw new NotificationChannelError(
							"recipient_permanent",
							"mailbox unavailable",
						);
					},
				},
			},
			reputation,
		});

		await worker.runNextNotificationTask({ limit: 1 });

		expect(reputation.recordRecipientFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				email: "commenter@example.test",
				reason: "mailbox unavailable",
			}),
		);
		await expect(repository.getRequired(task.id)).resolves.toMatchObject({
			status: "failed",
		});
	});

	it("injects commenter unsubscribe links without persisting plaintext tokens", async () => {
		const workspace = createTestWorkspace("qingyan-notification-worker-");
		applyInitialMigration(workspace.databaseFile);
		const clients = createDatabaseClients(workspace.databaseFile);
		const config = createTestConfig(
			workspace.databaseFile,
			workspace.logsDirectory,
		);
		const repository = new TaskRunRepository(clients.db);
		const { task, delivery } = await createQueuedCommenterReplyTask(
			clients.db,
			repository,
		);
		const sentMessages: Array<{ to: string; subject?: string; body: string }> =
			[];
		const worker = new NotificationWorker({
			queue: new DatabaseTaskQueue(clients.db),
			repository,
			adapters: {
				email: {
					send: async (input) => {
						sentMessages.push(input);
						return { providerMessageId: "smtp-commenter-1" };
					},
				},
			},
			templateContextBuilder: new NotificationTemplateContextBuilder(
				clients.db,
				config.server,
			),
		});

		try {
			await expect(repository.listDeliveriesForTask(task.id)).resolves.toEqual([
				expect.objectContaining({
					id: delivery.id,
					templateKey: "commenter.reply_approved",
				}),
			]);
			const processed = await worker.runNextNotificationTask({ limit: 1 });

			expect(processed).toBe(1);
			const processedDelivery = await repository.getDeliveryRequired(
				delivery.id,
			);
			expect(processedDelivery.lastError).toBeNull();
			expect(processedDelivery).toMatchObject({
				status: "sent",
			});
			await expect(repository.getRequired(task.id)).resolves.toMatchObject({
				status: "succeeded",
			});
			expect(sentMessages).toHaveLength(1);
			expect(sentMessages[0]).toMatchObject({
				to: "parent@example.com",
				subject: "[QingYan] Reply replied",
			});
			expect(sentMessages[0]?.body).toContain(
				"Reply（楼主） 在 Worker Reply 回复了你",
			);
			expect(sentMessages[0]?.body).toContain("reply content");
			expect(sentMessages[0]?.body).toContain(
				"查看页面：http://localhost:4321/posts/worker-reply/",
			);
			expect(sentMessages[0]?.body).toContain("如需退订可点击：");
			const unsubscribeUrl = sentMessages[0]?.body.match(
				/http:\/\/localhost:4401\/qingyan\/notifications\/unsubscribe\?token=([A-Za-z0-9_-]+)/u,
			);
			expect(unsubscribeUrl).toBeTruthy();
			const token = unsubscribeUrl?.[1] ?? "";
			const tokenRows = await clients.db.select().from(unsubscribeTokens);
			expect(tokenRows).toHaveLength(1);
			expect(JSON.stringify(tokenRows)).not.toContain(token);
			expect(
				JSON.stringify(await clients.db.select().from(taskRuns)),
			).not.toContain(token);

			const consume = await new UnsubscribeTokenService(
				clients.db,
				new CommenterPreferencesRepository(clients.db),
			).consume({ token });
			expect(consume).toEqual({ status: "unsubscribed" });
			await expect(
				clients.db.select().from(commenterNotificationPreferences),
			).resolves.toEqual([
				expect.objectContaining({
					email: "parent@example.com",
					notifyOnReply: false,
					source: "unsubscribe_link",
				}),
			]);
		} finally {
			clients.sqlite.close();
			workspace.cleanup();
		}
	});
});
