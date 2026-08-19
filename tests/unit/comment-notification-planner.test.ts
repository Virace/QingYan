import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import {
	commenterNotificationPreferences,
	comments,
	notificationDeliveries,
	pageThreads,
	siteSettings,
	sites,
	systemSettings,
	taskRuns,
} from "../../src/db/schema";
import { CommentNotificationPlanner } from "../../src/modules/notifications/comment-notification-planner";
import { hashNotificationEmail } from "../../src/modules/notifications/email-address-policy";
import { EmailReputationRepository } from "../../src/modules/notifications/email-reputation-repository";
import {
	applyInitialMigration,
	createTestWorkspace,
} from "../support/test-fixtures";

function requireEmailHash(email: string): string {
	const hash = hashNotificationEmail(email);
	if (!hash) {
		throw new Error(`Expected hash for ${email}`);
	}
	return hash;
}

function createFixture() {
	const workspace = createTestWorkspace("qingyan-notification-planner-");
	applyInitialMigration(workspace.databaseFile);
	const clients = createDatabaseClients(workspace.databaseFile);

	return {
		...clients,
		cleanup() {
			clients.sqlite.close();
			workspace.cleanup();
		},
	};
}

async function seedThread(fixture: ReturnType<typeof createFixture>) {
	const [site] = await fixture.db
		.insert(sites)
		.values({
			siteKey: "fangyuan",
			name: "FangYuan",
			allowedOriginsJson: JSON.stringify(["http://localhost:4321"]),
		})
		.returning();
	await fixture.db.insert(siteSettings).values({
		siteId: site.id,
		commenterReplyEmailEnabled: true,
	});
	const [thread] = await fixture.db
		.insert(pageThreads)
		.values({
			siteId: site.id,
			pageKey: "post:reply-notify",
			pageTitle: "Reply Notify",
			pageUrl: "/posts/reply-notify/",
			commentCount: 2,
			rootCommentCount: 1,
		})
		.returning();
	return { site, thread };
}

async function seedUsableSystemMail(fixture: ReturnType<typeof createFixture>) {
	await fixture.db.insert(systemSettings).values([
		{ category: "mail", key: "enabled", valueJson: JSON.stringify(true) },
		{
			category: "mail",
			key: "smtp.host",
			valueJson: JSON.stringify("smtp.example.test"),
		},
		{
			category: "mail",
			key: "smtp.from",
			valueJson: JSON.stringify("notify@example.test"),
		},
	]);
}

async function seedApprovedReply(fixture: ReturnType<typeof createFixture>) {
	const { site, thread } = await seedThread(fixture);
	await seedUsableSystemMail(fixture);
	await fixture.db.insert(comments).values([
		{
			id: "c_parent",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: null,
			status: "approved",
			authorName: "Parent",
			authorEmail: "Parent@Example.COM",
			authorEmailHash: requireEmailHash("parent@example.com"),
			contentRaw: "parent",
			contentHtml: "<p>parent</p>",
		},
		{
			id: "c_reply",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: "c_parent",
			status: "approved",
			authorName: "Reply",
			authorEmail: "reply@example.com",
			contentRaw: "reply",
			contentHtml: "<p>reply</p>",
		},
	]);
	await fixture.db.insert(commenterNotificationPreferences).values({
		id: "pref_parent",
		siteId: site.id,
		email: "parent@example.com",
		emailHash: requireEmailHash("parent@example.com"),
		notifyOnReply: true,
		source: "comment_form",
	});
	return { site, thread };
}

describe("comment notification planner", () => {
	it("creates one commenter email task for an approved reply", async () => {
		const fixture = createFixture();
		try {
			const { site } = await seedApprovedReply(fixture);
			const planner = new CommentNotificationPlanner(fixture.db);

			const result = await planner.planForCommentEvent({
				siteId: site.id,
				siteKey: "fangyuan",
				pageKey: "post:reply-notify",
				commentId: "c_reply",
				source: "public_api",
			});

			const tasks = await fixture.db.select().from(taskRuns);
			const deliveries = await fixture.db.select().from(notificationDeliveries);
			expect(result.createdCount).toBe(1);
			expect(tasks).toHaveLength(1);
			expect(tasks[0]).toMatchObject({
				category: "notification",
				type: "reply_approved",
				status: "queued",
				siteKey: "fangyuan",
				subjectType: "comment",
				subjectId: "c_reply",
			});
			expect(deliveries).toEqual([
				expect.objectContaining({
					taskRunId: tasks[0]?.id,
					recipientType: "commenter",
					recipientAddressSnapshot: "parent@example.com",
					recipientIdentityKey: requireEmailHash("parent@example.com"),
					channel: "email",
					templateKey: "commenter.reply_approved",
				}),
			]);
		} finally {
			fixture.cleanup();
		}
	});

	it("records decisions for skipped sources and non-approved replies", async () => {
		const fixture = createFixture();
		try {
			const { site } = await seedApprovedReply(fixture);
			const planner = new CommentNotificationPlanner(fixture.db);

			expect(
				await planner.planForCommentEvent({
					siteId: site.id,
					siteKey: "fangyuan",
					pageKey: "post:reply-notify",
					commentId: "c_reply",
					source: "import",
				}),
			).toMatchObject({ createdCount: 0 });
			await fixture.db
				.update(comments)
				.set({ status: "pending" })
				.where(eq(comments.id, "c_reply"));
			expect(
				await planner.planForCommentEvent({
					siteId: site.id,
					siteKey: "fangyuan",
					pageKey: "post:reply-notify",
					commentId: "c_reply",
					source: "public_api",
				}),
			).toMatchObject({ createdCount: 0 });
			const decisions = await fixture.db.select().from(taskRuns);
			expect(decisions).toHaveLength(2);
			expect(
				decisions.map((decision) => ({
					status: decision.status,
					summary: JSON.parse(decision.payloadSummaryJson),
				})),
			).toEqual(
				expect.arrayContaining([
					{
						status: "skipped",
						summary: expect.objectContaining({
							reasonCode: "source_excluded",
						}),
					},
					{
						status: "skipped",
						summary: expect.objectContaining({
							reasonCode: "comment_not_approved_reply",
						}),
					},
				]),
			);
		} finally {
			fixture.cleanup();
		}
	});

	it("does not create commenter tasks when commenter reply email is disabled", async () => {
		const fixture = createFixture();
		try {
			const { site } = await seedApprovedReply(fixture);
			await fixture.db
				.update(siteSettings)
				.set({ commenterReplyEmailEnabled: false })
				.where(eq(siteSettings.siteId, site.id));
			const planner = new CommentNotificationPlanner(fixture.db);

			const result = await planner.planForCommentEvent({
				siteId: site.id,
				siteKey: "fangyuan",
				pageKey: "post:reply-notify",
				commentId: "c_reply",
				source: "public_api",
			});

			expect(result).toMatchObject({ createdCount: 0, taskIds: [] });
			expect(await fixture.db.select().from(taskRuns)).toEqual([
				expect.objectContaining({
					type: "notification_email_decision",
					status: "skipped",
					skipReason: "site_commenter_email_disabled",
				}),
			]);
		} finally {
			fixture.cleanup();
		}
	});

	it("does not create commenter tasks when system mail is unusable", async () => {
		const fixture = createFixture();
		try {
			const { site } = await seedApprovedReply(fixture);
			await fixture.db
				.update(systemSettings)
				.set({ valueJson: JSON.stringify(false) })
				.where(
					and(
						eq(systemSettings.category, "mail"),
						eq(systemSettings.key, "enabled"),
					),
				);
			const planner = new CommentNotificationPlanner(fixture.db);

			const result = await planner.planForCommentEvent({
				siteId: site.id,
				siteKey: "fangyuan",
				pageKey: "post:reply-notify",
				commentId: "c_reply",
				source: "public_api",
			});

			expect(result).toMatchObject({ createdCount: 0, taskIds: [] });
			expect(await fixture.db.select().from(taskRuns)).toEqual([
				expect.objectContaining({
					type: "notification_email_decision",
					status: "skipped",
					skipReason: "system_email_unavailable",
				}),
			]);
		} finally {
			fixture.cleanup();
		}
	});

	it.each([
		{
			name: "unsubscribed",
			reasonCode: "commenter_unsubscribed",
			status: "suppressed",
			prepare: async (fixture: ReturnType<typeof createFixture>) => {
				await fixture.db
					.update(commenterNotificationPreferences)
					.set({
						unsubscribedAt: "2026-06-02T10:00:00.000Z",
					})
					.where(eq(commenterNotificationPreferences.id, "pref_parent"));
			},
		},
		{
			name: "staff_parent",
			reasonCode: "commenter_not_visitor",
			status: "skipped",
			prepare: async (fixture: ReturnType<typeof createFixture>) => {
				await fixture.db
					.update(comments)
					.set({ authorIdentity: "staff" })
					.where(eq(comments.id, "c_parent"));
			},
		},
		{
			name: "same_email",
			reasonCode: "same_recipient",
			status: "skipped",
			prepare: async (fixture: ReturnType<typeof createFixture>) => {
				await fixture.db
					.update(comments)
					.set({ authorEmail: "parent@example.com" })
					.where(eq(comments.id, "c_reply"));
			},
		},
		{
			name: "suppressed",
			reasonCode: "email_reputation_suppressed",
			status: "suppressed",
			prepare: async (fixture: ReturnType<typeof createFixture>) => {
				const reputation = new EmailReputationRepository(fixture.db);
				const baseTime = Date.now();
				for (let attempt = 0; attempt < 5; attempt += 1) {
					await reputation.recordRecipientFailure({
						siteId: 1,
						email: "parent@example.com",
						reason: "bounce",
						nowIso: new Date(baseTime + attempt * 60_000).toISOString(),
					});
				}
			},
		},
	])("skips $name recipients", async (testCase) => {
		const fixture = createFixture();
		try {
			const { site } = await seedApprovedReply(fixture);
			await testCase.prepare(fixture);
			const planner = new CommentNotificationPlanner(fixture.db);

			const result = await planner.planForCommentEvent({
				siteId: site.id,
				siteKey: "fangyuan",
				pageKey: "post:reply-notify",
				commentId: "c_reply",
				source: "admin_moderation",
			});

			expect(result, testCase.name).toMatchObject({ createdCount: 0 });
			expect(await fixture.db.select().from(taskRuns)).toEqual([
				expect.objectContaining({
					type: "notification_email_decision",
					status: testCase.status,
					skipReason: testCase.reasonCode,
				}),
			]);
		} finally {
			fixture.cleanup();
		}
	});

	it("does not create duplicate tasks for the same reply and recipient", async () => {
		const fixture = createFixture();
		try {
			const { site } = await seedApprovedReply(fixture);
			const planner = new CommentNotificationPlanner(fixture.db);

			await planner.planForCommentEvent({
				siteId: site.id,
				siteKey: "fangyuan",
				pageKey: "post:reply-notify",
				commentId: "c_reply",
				source: "public_api",
			});
			await planner.planForCommentEvent({
				siteId: site.id,
				siteKey: "fangyuan",
				pageKey: "post:reply-notify",
				commentId: "c_reply",
				source: "admin_moderation",
			});

			expect(await fixture.db.select().from(taskRuns)).toHaveLength(1);
			expect(
				await fixture.db.select().from(notificationDeliveries),
			).toHaveLength(1);
		} finally {
			fixture.cleanup();
		}
	});

	it("keeps an event-level no-send decision terminal when settings later change", async () => {
		const fixture = createFixture();
		try {
			const { site } = await seedApprovedReply(fixture);
			const planner = new CommentNotificationPlanner(fixture.db);
			await fixture.db
				.update(siteSettings)
				.set({ commenterReplyEmailEnabled: false })
				.where(eq(siteSettings.siteId, site.id));

			await planner.planForCommentEvent({
				siteId: site.id,
				siteKey: "fangyuan",
				pageKey: "post:reply-notify",
				commentId: "c_reply",
				source: "public_api",
			});
			await fixture.db
				.update(siteSettings)
				.set({ commenterReplyEmailEnabled: true })
				.where(eq(siteSettings.siteId, site.id));
			await planner.planForCommentEvent({
				siteId: site.id,
				siteKey: "fangyuan",
				pageKey: "post:reply-notify",
				commentId: "c_reply",
				source: "public_api",
			});

			expect(await fixture.db.select().from(taskRuns)).toEqual([
				expect.objectContaining({
					type: "notification_email_decision",
					status: "skipped",
					skipReason: "site_commenter_email_disabled",
				}),
			]);
			expect(await fixture.db.select().from(notificationDeliveries)).toEqual(
				[],
			);
		} finally {
			fixture.cleanup();
		}
	});
});
