import { eq } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { siteSettings } from "../../db/schema";
import { TaskRunRepository } from "../tasks/task-run-repository";
import type { NotificationDeliveryRecord, TaskRunRecord } from "../tasks/types";
import { BackendUserNotificationPreferencesRepository } from "./backend-user-preferences-repository";
import { channelTargetSnapshot } from "./channel-configs-repository";
import {
	type SiteBackendNotificationEventType,
	SiteNotificationEventsRepository,
} from "./site-notification-events-repository";

export type CommentNotificationSource =
	| "public_api"
	| "admin_reply"
	| "admin_moderation"
	| "akismet"
	| "import"
	| "migration"
	| "system";

export type BackendUserCommentStatus =
	| "pending"
	| "approved"
	| "spam"
	| "trash"
	| "deleted";

export interface BackendUserNotificationEvent {
	source: CommentNotificationSource;
	siteId: number;
	siteKey: string;
	commentId: string;
	pageKey: string;
	status: BackendUserCommentStatus;
	previousStatus: BackendUserCommentStatus | null;
	authorUserId: number | null;
	verifiedAuthorEmail?: string | null;
	contentRaw?: string | null;
	createdAt?: string | null;
}

export type NotificationChannelFilter = Array<"email" | "webhook" | "wxpusher">;

export interface BackendUserNotificationPlanResult {
	tasks: TaskRunRecord[];
	deliveries: Array<
		NotificationDeliveryRecord & {
			event: SiteBackendNotificationEventType;
		}
	>;
	createdCount: number;
}

function resolveAdminEvent(
	event: BackendUserNotificationEvent,
): SiteBackendNotificationEventType | null {
	if (event.source === "import" || event.source === "migration") {
		return null;
	}
	if (event.status === "spam") {
		return null;
	}
	if (
		event.source === "admin_moderation" &&
		event.previousStatus === "pending" &&
		event.status === "approved"
	) {
		return null;
	}
	if (event.status === "pending") {
		return "admin_comment_pending";
	}
	if (event.status === "approved") {
		return "admin_comment_approved";
	}
	return null;
}

function taskTypeForEvent(event: SiteBackendNotificationEventType) {
	return event === "admin_comment_pending"
		? "backend_user_comment_pending"
		: "backend_user_comment_approved";
}

function templateKeyForEvent(event: SiteBackendNotificationEventType) {
	return event === "admin_comment_pending"
		? "backend_user.comment.pending"
		: "backend_user.comment.approved";
}

function idempotencyKey(input: {
	commentId: string;
	targetIdentity: string;
	channelConfigId: string;
	event: SiteBackendNotificationEventType;
}) {
	return [
		"backend_user_comment",
		input.commentId,
		input.targetIdentity,
		input.channelConfigId,
		input.event,
	].join(":");
}

function digestRunAfter(minutes: number | null, now = new Date()) {
	if (!minutes || minutes <= 0) {
		return null;
	}
	return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export class BackendUserNotificationPlanner {
	private readonly events: SiteNotificationEventsRepository;
	private readonly preferences: BackendUserNotificationPreferencesRepository;
	private readonly tasks: TaskRunRepository;

	public constructor(private readonly db: AppDatabase) {
		this.events = new SiteNotificationEventsRepository(db);
		this.preferences = new BackendUserNotificationPreferencesRepository(db);
		this.tasks = new TaskRunRepository(db);
	}

	public async planForCommentEvent(
		event: BackendUserNotificationEvent,
		options: {
			channelFilter?: NotificationChannelFilter;
		} = {},
	): Promise<BackendUserNotificationPlanResult> {
		const [settings] = await this.db
			.select({
				backendNotificationsEnabled: siteSettings.backendNotificationsEnabled,
			})
			.from(siteSettings)
			.where(eq(siteSettings.siteId, event.siteId))
			.limit(1);
		if (!settings?.backendNotificationsEnabled) {
			return { tasks: [], deliveries: [], createdCount: 0 };
		}

		const adminEvent = resolveAdminEvent(event);
		if (!adminEvent) {
			return { tasks: [], deliveries: [], createdCount: 0 };
		}

		const recipients = await this.events.listActiveEmailRecipients({
			siteId: event.siteId,
			eventType: adminEvent,
		});
		const externalChannels = await this.events.listExternalChannels({
			siteId: event.siteId,
			eventType: adminEvent,
		});
		const tasks: TaskRunRecord[] = [];
		const deliveries: BackendUserNotificationPlanResult["deliveries"] = [];

		if (!options.channelFilter || options.channelFilter.includes("email")) {
			for (const recipient of recipients) {
				const channelConfigId = "email:default";
				const preference = await this.preferences.getPreference({
					userId: recipient.userId,
					channel: "email",
					channelConfigRef: channelConfigId,
				});
				if (
					!(await this.preferences.isChannelAllowedForUser({
						userId: recipient.userId,
						channel: "email",
						channelConfigRef: channelConfigId,
					}))
				) {
					continue;
				}

				const key = idempotencyKey({
					commentId: event.commentId,
					targetIdentity: `user:${recipient.userId}`,
					channelConfigId,
					event: adminEvent,
				});
				if (preference.digestMode !== "off") {
					const task = await this.tasks.create({
						type: "backend_user_comment_digest",
						category: "notification",
						siteId: event.siteId,
						siteKey: event.siteKey,
						subjectType: "comment",
						subjectId: event.commentId,
						idempotencyKey: `digest:${key}`,
						runAfter:
							preference.digestMode === "interval"
								? digestRunAfter(preference.digestIntervalMinutes)
								: null,
						payloadSummary: {
							event: adminEvent,
							siteId: event.siteId,
							userId: recipient.userId,
							channel: "email",
							channelConfigId,
							channelConfigName: "默认邮件",
							eventCount: 1,
						},
						payload: {
							event: adminEvent,
							siteId: event.siteId,
							siteKey: event.siteKey,
							userId: recipient.userId,
							channel: "email",
							channelConfigId,
							channelConfigName: "默认邮件",
							eventCount: 1,
							eventIds: [event.commentId],
						},
					});
					tasks.push(task);
					continue;
				}

				const task = await this.tasks.create({
					type: taskTypeForEvent(adminEvent),
					category: "notification",
					siteId: event.siteId,
					siteKey: event.siteKey,
					subjectType: "comment",
					subjectId: event.commentId,
					idempotencyKey: key,
					payloadSummary: {
						event: adminEvent,
						siteId: event.siteId,
						userId: recipient.userId,
						channel: "email",
						channelConfigId,
						channelConfigName: "默认邮件",
					},
					payload: {
						event: adminEvent,
						siteId: event.siteId,
						siteKey: event.siteKey,
						pageKey: event.pageKey,
						commentId: event.commentId,
						userId: recipient.userId,
						channel: "email",
						channelConfigId,
						channelConfigName: "默认邮件",
						includeCommentContent: recipient.includeCommentContent,
						contentRaw:
							recipient.includeCommentContent === "none"
								? null
								: event.contentRaw,
					},
				});
				tasks.push(task);
				const delivery = await this.tasks.createDelivery({
					taskRunId: task.id,
					channel: "email",
					channelConfigRef: channelConfigId,
					channelConfigNameSnapshot: "默认邮件",
					recipientType: "backend_user",
					recipientUserId: recipient.userId,
					recipientAddressSnapshot: recipient.email,
					recipientIdentityKey: `backend_user:${recipient.userId}:${channelConfigId}`,
					eventFamily: adminEvent,
					templateKey: templateKeyForEvent(adminEvent),
				});
				deliveries.push({ ...delivery, event: adminEvent });
			}
		}

		for (const config of externalChannels) {
			if (!config.enabled || config.type === "email") {
				continue;
			}
			if (
				options.channelFilter &&
				!options.channelFilter.includes(config.type)
			) {
				continue;
			}
			const key = idempotencyKey({
				commentId: event.commentId,
				targetIdentity: `external:${config.id}`,
				channelConfigId: config.id,
				event: adminEvent,
			});
			const task = await this.tasks.create({
				type: taskTypeForEvent(adminEvent),
				category: "notification",
				siteId: event.siteId,
				siteKey: event.siteKey,
				subjectType: "comment",
				subjectId: event.commentId,
				idempotencyKey: key,
				payloadSummary: {
					event: adminEvent,
					siteId: event.siteId,
					channel: config.type,
					channelConfigId: config.id,
					channelConfigName: config.name,
				},
				payload: {
					event: adminEvent,
					siteId: event.siteId,
					siteKey: event.siteKey,
					pageKey: event.pageKey,
					commentId: event.commentId,
					channel: config.type,
					channelConfigId: config.id,
					channelConfigName: config.name,
					includeCommentContent: "summary",
					contentRaw: event.contentRaw,
				},
			});
			tasks.push(task);
			const delivery = await this.tasks.createDelivery({
				taskRunId: task.id,
				channel: config.type,
				channelConfigRef: config.id,
				channelConfigNameSnapshot: config.name,
				recipientType: "external_target",
				recipientUserId: null,
				recipientAddressSnapshot: channelTargetSnapshot(config),
				recipientIdentityKey: `external_target:${config.id}`,
				eventFamily: adminEvent,
				templateKey: templateKeyForEvent(adminEvent),
			});
			deliveries.push({ ...delivery, event: adminEvent });
		}

		return {
			tasks,
			deliveries,
			createdCount: tasks.length,
		};
	}
}
