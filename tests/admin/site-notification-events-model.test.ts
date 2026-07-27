import { describe, expect, it } from "vitest";

import type {
	AdminSettings,
	SiteNotificationEventSettings,
} from "../../apps/admin/src/api/admin";
import {
	buildSiteNotificationPayload,
	countSiteNotificationChanges,
	normalizeSiteNotificationEvents,
	updateEventExternalTargets,
	updateEventRecipients,
} from "../../apps/admin/src/components/admin/settings/site-notification-events-model";

const recipient = {
	userId: 7,
	username: "virace",
	displayName: "Virace",
	email: "virace@example.test",
	includeCommentContent: "summary" as const,
};

function notifications(
	events: SiteNotificationEventSettings[],
): AdminSettings["notifications"] {
	return {
		capabilities: {
			mailReady: true,
			externalTargetCount: 1,
		},
		commenter: {
			replyEmailEnabled: true,
			replyEmailDefaultChecked: false,
		},
		backend: {
			enabled: true,
			events,
		},
		channelConfigs: [],
	};
}

describe("site notification event settings model", () => {
	it("always presents both fixed notification types", () => {
		expect(normalizeSiteNotificationEvents([])).toEqual([
			{
				eventType: "admin_comment_pending",
				recipients: [],
				externalChannelConfigIds: [],
			},
			{
				eventType: "admin_comment_approved",
				recipients: [],
				externalChannelConfigIds: [],
			},
		]);
	});

	it("updates each event independently and builds one event-first save payload", () => {
		const initial = normalizeSiteNotificationEvents([]);
		const withRecipient = updateEventRecipients(
			initial,
			"admin_comment_pending",
			[recipient],
		);
		const withExternal = updateEventExternalTargets(
			withRecipient,
			"admin_comment_approved",
			["webhook:ops"],
		);

		expect(buildSiteNotificationPayload(notifications(withExternal))).toEqual({
			commenter: {
				replyEmailEnabled: true,
				replyEmailDefaultChecked: false,
			},
			backend: {
				enabled: true,
				events: [
					{
						eventType: "admin_comment_pending",
						recipientUserIds: [7],
						externalChannelConfigIds: [],
					},
					{
						eventType: "admin_comment_approved",
						recipientUserIds: [],
						externalChannelConfigIds: ["webhook:ops"],
					},
				],
			},
		});
	});

	it("counts additions and removals across both events", () => {
		const saved = notifications(normalizeSiteNotificationEvents([]));
		const draft = notifications([
			{
				eventType: "admin_comment_pending",
				recipients: [recipient],
				externalChannelConfigIds: [],
			},
			{
				eventType: "admin_comment_approved",
				recipients: [],
				externalChannelConfigIds: ["webhook:ops"],
			},
		]);

		expect(countSiteNotificationChanges(saved, draft)).toBe(2);
	});
});
