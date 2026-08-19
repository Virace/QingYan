import { describe, expect, it } from "vitest";

import type {
	CommentEmailDeliveryItem,
	CommentEmailDeliverySummary,
} from "../../apps/admin/src/api/email-delivery";
import {
	MAX_EMAIL_DELIVERY_POLL_COUNT,
	emailDeliveryPhaseLabel,
	emailDeliveryRecoveryTarget,
	emailDeliveryStatePresentation,
	shouldPollEmailDelivery,
} from "../../apps/admin/src/components/admin/content/comment-email-delivery-model";

function summary(
	overrides: Partial<CommentEmailDeliverySummary> = {},
): CommentEmailDeliverySummary {
	return {
		state: "unknown",
		deliveryCount: 0,
		acceptedCount: 0,
		failedCount: 0,
		processingCount: 0,
		notSentDecisionCount: 0,
		lastUpdatedAt: null,
		...overrides,
	};
}

function item(
	overrides: Partial<CommentEmailDeliveryItem> = {},
): CommentEmailDeliveryItem {
	return {
		kind: "delivery",
		channel: "email",
		flow: "site_staff_comment",
		state: "processing",
		phase: "queued",
		recipient: { label: "站点人员", address: "a***@example.test" },
		attemptCount: 0,
		maxAttempts: 3,
		acceptedAt: null,
		updatedAt: "2026-08-19T00:00:00.000Z",
		reasonCode: null,
		errorKind: null,
		message: null,
		...overrides,
	};
}

describe("comment email delivery presentation", () => {
	it.each([
		[
			summary({
				state: "accepted",
				deliveryCount: 2,
				acceptedCount: 2,
			}),
			"邮件：服务商已接受，2/2",
		],
		[
			summary({
				state: "failed",
				deliveryCount: 2,
				acceptedCount: 1,
				failedCount: 1,
			}),
			"邮件：部分失败，已接受 1，失败 1",
		],
		[
			summary({ state: "processing", processingCount: 1 }),
			"邮件：处理中，1 项",
		],
		[
			summary({ state: "not_sent", notSentDecisionCount: 2 }),
			"邮件：未发送，2 项决定",
		],
		[summary(), "邮件：无历史投递记录"],
	] as const)("builds an accessible label for every server state", (input, label) => {
		expect(emailDeliveryStatePresentation(input).accessibleLabel).toBe(label);
	});

	it("describes processing phases without implying final delivery", () => {
		expect(emailDeliveryPhaseLabel(item({ phase: "queued" }))).toBe("排队中");
		expect(emailDeliveryPhaseLabel(item({ phase: "delayed" }))).toBe(
			"等待摘要发送",
		);
		expect(
			emailDeliveryPhaseLabel(
				item({ phase: "retrying", attemptCount: 1, maxAttempts: 3 }),
			),
		).toBe("正在重试（已尝试 1/3 次）");
	});

	it("offers only supported recovery destinations", () => {
		expect(
			emailDeliveryRecoveryTarget(
				item({
					state: "not_sent",
					phase: "not_sent",
					reasonCode: "system_email_unavailable",
				}),
			),
		).toBe("system_mail");
		expect(
			emailDeliveryRecoveryTarget(
				item({
					state: "not_sent",
					phase: "not_sent",
					reasonCode: "no_email_recipients",
				}),
			),
		).toBe("site_notifications");
		expect(
			emailDeliveryRecoveryTarget(
				item({
					state: "not_sent",
					phase: "not_sent",
					reasonCode: "commenter_unsubscribed",
				}),
			),
		).toBeNull();
	});

	it("polls only visible processing details and stops at the cap or terminal state", () => {
		const processing = summary({ state: "processing", processingCount: 1 });
		expect(shouldPollEmailDelivery(processing, 0, true)).toBe(true);
		expect(
			shouldPollEmailDelivery(processing, MAX_EMAIL_DELIVERY_POLL_COUNT, true),
		).toBe(false);
		expect(shouldPollEmailDelivery(processing, 0, false)).toBe(false);
		expect(
			shouldPollEmailDelivery(summary({ state: "accepted" }), 0, true),
		).toBe(false);
	});
});
