import type {
	AdminSettings,
	SiteNotificationEvent,
	SiteNotificationEventRecipient,
	SiteNotificationEventSettings,
} from "../../../api/admin";

export const siteNotificationEventOrder: SiteNotificationEvent[] = [
	"admin_comment_pending",
	"admin_comment_approved",
];

export function normalizeSiteNotificationEvents(
	events: SiteNotificationEventSettings[] | undefined,
): SiteNotificationEventSettings[] {
	return siteNotificationEventOrder.map(
		(eventType) =>
			events?.find((event) => event.eventType === eventType) ?? {
				eventType,
				recipients: [],
				externalChannelConfigIds: [],
			},
	);
}

export function updateEventRecipients(
	events: SiteNotificationEventSettings[],
	eventType: SiteNotificationEvent,
	recipients: SiteNotificationEventRecipient[],
): SiteNotificationEventSettings[] {
	return normalizeSiteNotificationEvents(events).map((event) =>
		event.eventType === eventType ? { ...event, recipients } : event,
	);
}

export function updateEventExternalTargets(
	events: SiteNotificationEventSettings[],
	eventType: SiteNotificationEvent,
	externalChannelConfigIds: string[],
): SiteNotificationEventSettings[] {
	return normalizeSiteNotificationEvents(events).map((event) =>
		event.eventType === eventType
			? { ...event, externalChannelConfigIds }
			: event,
	);
}

export function buildSiteNotificationPayload(
	notifications: AdminSettings["notifications"],
) {
	return {
		commenter: notifications.commenter,
		backend: {
			enabled: notifications.backend.enabled,
			events: normalizeSiteNotificationEvents(notifications.backend.events).map(
				(event) => ({
					eventType: event.eventType,
					recipientUserIds: event.recipients.map(
						(recipient) => recipient.userId,
					),
					externalChannelConfigIds: event.externalChannelConfigIds,
				}),
			),
		},
	};
}

function symmetricDifferenceCount<T>(left: T[], right: T[]): number {
	const leftSet = new Set(left);
	const rightSet = new Set(right);
	let count = 0;
	for (const value of leftSet) {
		if (!rightSet.has(value)) {
			count += 1;
		}
	}
	for (const value of rightSet) {
		if (!leftSet.has(value)) {
			count += 1;
		}
	}
	return count;
}

export function countSiteNotificationChanges(
	saved: AdminSettings["notifications"],
	draft: AdminSettings["notifications"],
): number {
	let count = 0;
	if (saved.commenter.replyEmailEnabled !== draft.commenter.replyEmailEnabled) {
		count += 1;
	}
	if (
		saved.commenter.replyEmailDefaultChecked !==
		draft.commenter.replyEmailDefaultChecked
	) {
		count += 1;
	}
	if (saved.backend.enabled !== draft.backend.enabled) {
		count += 1;
	}
	const savedEvents = normalizeSiteNotificationEvents(saved.backend.events);
	const draftEvents = normalizeSiteNotificationEvents(draft.backend.events);
	for (const eventType of siteNotificationEventOrder) {
		const savedEvent = savedEvents.find(
			(event) => event.eventType === eventType,
		);
		const draftEvent = draftEvents.find(
			(event) => event.eventType === eventType,
		);
		count += symmetricDifferenceCount(
			savedEvent?.recipients.map((recipient) => recipient.userId) ?? [],
			draftEvent?.recipients.map((recipient) => recipient.userId) ?? [],
		);
		count += symmetricDifferenceCount(
			savedEvent?.externalChannelConfigIds ?? [],
			draftEvent?.externalChannelConfigIds ?? [],
		);
	}
	return count;
}
