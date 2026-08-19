import { afterEach, describe, expect, it, vi } from "vitest";

import { sites } from "../../src/db/schema";
import { CommentEmailDeliveryRepository } from "../../src/modules/notifications/comment-email-delivery-repository";
import { TaskEventLogRepository } from "../../src/modules/tasks/task-event-log-repository";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	vi.restoreAllMocks();
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("CommentEmailDeliveryRepository", () => {
	it("atomically creates one terminal decision and one safe event", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const [site] = await fixture.app.db.select().from(sites).limit(1);
		if (!site) {
			throw new Error("Expected test site");
		}
		const repository = new CommentEmailDeliveryRepository(fixture.app.db);

		const first = await repository.createDecision({
			siteId: site.id,
			siteKey: site.siteKey,
			commentId: "comment_decision",
			flow: "commenter_reply",
			eventKey: "public_api:approved",
			status: "suppressed",
			reasonCode: "email_reputation_suppressed",
			source: "public_api",
		});
		const duplicate = await repository.createDecision({
			siteId: site.id,
			siteKey: site.siteKey,
			commentId: "comment_decision",
			flow: "commenter_reply",
			eventKey: "public_api:approved",
			status: "suppressed",
			reasonCode: "email_reputation_suppressed",
			source: "public_api",
		});

		expect(duplicate.id).toBe(first.id);
		expect(first).toMatchObject({
			type: "notification_email_decision",
			category: "notification",
			status: "suppressed",
			subjectType: "comment",
			subjectId: "comment_decision",
			skipReason: "email_reputation_suppressed",
		});
		const events = await new TaskEventLogRepository(fixture.app.db).listForRun({
			taskRunId: first.id,
			limit: 10,
			offset: 0,
			includePrivate: true,
		});
		expect(events.items).toEqual([
			expect.objectContaining({
				sequence: 1,
				eventType: "notification.email.decision",
				message: "该邮箱因投递信誉策略被暂缓发送。",
				data: {
					flow: "commenter_reply",
					reasonCode: "email_reputation_suppressed",
				},
			}),
		]);
	});

	it("loads all comment facts with batch task and delivery queries", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const [site] = await fixture.app.db.select().from(sites).limit(1);
		if (!site) {
			throw new Error("Expected test site");
		}
		const taskRuns = new TaskRunRepository(fixture.app.db);
		const firstTask = await taskRuns.create({
			type: "backend_user_comment_approved",
			category: "notification",
			siteId: site.id,
			siteKey: site.siteKey,
			subjectType: "comment",
			subjectId: "comment_a",
			payloadSummary: { channel: "email" },
			payload: {},
		});
		await taskRuns.createDelivery({
			taskRunId: firstTask.id,
			channel: "email",
			recipientType: "backend_user",
			recipientAddressSnapshot: "admin@example.test",
			recipientIdentityKey: "backend_user:1",
			eventFamily: "admin_comment_approved",
			templateKey: "backend_user.comment.approved",
		});
		await taskRuns.create({
			type: "unrelated",
			category: "maintenance",
			subjectType: "comment",
			subjectId: "comment_a",
			payloadSummary: {},
			payload: {},
		});
		await new CommentEmailDeliveryRepository(fixture.app.db).createDecision({
			siteId: site.id,
			siteKey: site.siteKey,
			commentId: "comment_b",
			flow: "commenter_reply",
			eventKey: "system:excluded",
			status: "skipped",
			reasonCode: "source_excluded",
			source: "system",
		});
		const listTasks = vi.spyOn(
			TaskRunRepository.prototype,
			"listNotificationRunsBySubjects",
		);
		const listDeliveries = vi.spyOn(
			TaskRunRepository.prototype,
			"listDeliveriesForTasks",
		);

		const facts = await new CommentEmailDeliveryRepository(
			fixture.app.db,
		).listFactsByCommentIds(["comment_a", "comment_b", "comment_missing"]);

		expect(facts.get("comment_a")).toEqual([
			expect.objectContaining({
				task: expect.objectContaining({ id: firstTask.id }),
				deliveries: [
					expect.objectContaining({
						channel: "email",
						recipientAddressSnapshot: "admin@example.test",
					}),
				],
			}),
		]);
		expect(facts.get("comment_b")).toEqual([
			expect.objectContaining({
				task: expect.objectContaining({
					type: "notification_email_decision",
					status: "skipped",
				}),
				deliveries: [],
			}),
		]);
		expect(facts.has("comment_missing")).toBe(false);
		expect(listTasks).toHaveBeenCalledOnce();
		expect(listTasks).toHaveBeenCalledWith({
			subjectType: "comment",
			subjectIds: ["comment_a", "comment_b", "comment_missing"],
		});
		expect(listDeliveries).toHaveBeenCalledOnce();
	});
});
