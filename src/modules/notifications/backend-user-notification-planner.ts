import { eq } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { siteSettings } from "../../db/schema";
import { TaskRunRepository } from "../tasks/task-run-repository";
import type { NotificationDeliveryRecord, TaskRunRecord } from "../tasks/types";
import { BackendUserNotificationPreferencesRepository } from "./backend-user-preferences-repository";
import {
	type BackendUserNotificationEventType,
	BackendUserNotificationRecipientsRepository,
} from "./backend-user-recipients-repository";
import { channelTargetSnapshot } from "./channel-configs-repository";

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
			event: BackendUserNotificationEventType;
		}
	>;
	createdCount: number;
}

function resolveAdminEvent(
	event: BackendUserNotificationEvent,
): BackendUserNotificationEventType | null {
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

function taskTypeForEvent(event: BackendUserNotificationEventType) {
	return event === "admin_comment_pending"
		? "backend_user_comment_pending"
		: "backend_user_comment_approved";
}

function templateKeyForEvent(event: BackendUserNotificationEventType) {
	return event === "admin_comment_pending"
		? "backend_user.comment.pending"
		: "backend_user.comment.approved";
}

function idempotencyKey(input: {
	commentId: string;
	userId: number;
	channelConfigId: string;
	event: BackendUserNotificationEventType;
}) {
	return [
		"backend_user_comment",
		input.commentId,
		input.userId,
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
	private readonly recipients: BackendUserNotificationRecipientsRepository;
	private readonly preferences: BackendUserNotificationPreferencesRepository;
	private readonly tasks: TaskRunRepository;

	public constructor(private readonly db: AppDatabase) {
		this.recipients = new BackendUserNotificationRecipientsRepository(db);
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

		const recipients = await this.recipients.listSiteRecipients(event.siteId);
		const activeUsers = await this.recipients.listActiveSiteRecipientUsers({
			siteId: event.siteId,
			userIds: recipients.map((recipient) => recipient.userId),
		});
		const activeUserById = new Map(activeUsers.map((user) => [user.id, user]));
		const tasks: TaskRunRecord[] = [];
		const deliveries: BackendUserNotificationPlanResult["deliveries"] = [];

		for (const recipient of recipients) {
			if (!recipient.enabled) {
				continue;
			}
			const user = activeUserById.get(recipient.userId);
			if (!user) {
				continue;
			}

			for (const route of recipient.routes) {
				if (
					!route.enabled ||
					route.eventType !== adminEvent ||
					!route.channelConfig
				) {
					continue;
				}
				const channel = route.channelConfig.type;
				if (options.channelFilter && !options.channelFilter.includes(channel)) {
					continue;
				}
				if (!route.channelConfig.enabled) {
					continue;
				}
				const preference = await this.preferences.getPreference({
					userId: recipient.userId,
					channel,
					channelConfigRef: route.channelConfigId,
				});
				if (
					!(await this.preferences.isChannelAllowedForUser({
						userId: recipient.userId,
						channel,
						channelConfigRef: route.channelConfigId,
					}))
				) {
					continue;
				}

				const key = idempotencyKey({
					commentId: event.commentId,
					userId: recipient.userId,
					channelConfigId: route.channelConfigId,
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
							channel,
							channelConfigId: route.channelConfigId,
							channelConfigName: route.channelName,
							eventCount: 1,
						},
						payload: {
							event: adminEvent,
							siteId: event.siteId,
							siteKey: event.siteKey,
							userId: recipient.userId,
							channel,
							channelConfigId: route.channelConfigId,
							channelConfigName: route.channelName,
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
						channel,
						channelConfigId: route.channelConfigId,
						channelConfigName: route.channelName,
					},
					payload: {
						event: adminEvent,
						siteId: event.siteId,
						siteKey: event.siteKey,
						pageKey: event.pageKey,
						commentId: event.commentId,
						userId: recipient.userId,
						channel,
						channelConfigId: route.channelConfigId,
						channelConfigName: route.channelName,
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
					channel,
					channelConfigRef: route.channelConfigId,
					channelConfigNameSnapshot: route.channelName,
					recipientType: "backend_user",
					recipientUserId: recipient.userId,
					recipientAddressSnapshot: channelTargetSnapshot(
						route.channelConfig,
						user.email,
					),
					recipientIdentityKey: `backend_user:${recipient.userId}:${route.channelConfigId}`,
					eventFamily: adminEvent,
					templateKey: templateKeyForEvent(adminEvent),
				});
				deliveries.push({
					...delivery,
					event: adminEvent,
				});
			}
		}

		return {
			tasks,
			deliveries,
			createdCount: tasks.length,
		};
	}
}
