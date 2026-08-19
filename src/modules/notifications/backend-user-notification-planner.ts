import { eq } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { siteSettings } from "../../db/schema";
import { isSystemMailUsable } from "../comments/public-contract";
import { RuntimeSystemSettingsService } from "../system-settings/service";
import { TaskRunRepository } from "../tasks/task-run-repository";
import type { NotificationDeliveryRecord, TaskRunRecord } from "../tasks/types";
import { BackendUserNotificationPreferencesRepository } from "./backend-user-preferences-repository";
import { channelTargetSnapshot } from "./channel-configs-repository";
import { CommentEmailDeliveryRepository } from "./comment-email-delivery-repository";
import type { CommentEmailDecisionReason } from "./comment-email-delivery-status";
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
	private readonly emailDelivery: CommentEmailDeliveryRepository;

	public constructor(private readonly db: AppDatabase) {
		this.events = new SiteNotificationEventsRepository(db);
		this.preferences = new BackendUserNotificationPreferencesRepository(db);
		this.tasks = new TaskRunRepository(db);
		this.emailDelivery = new CommentEmailDeliveryRepository(db);
	}

	public async planForCommentEvent(
		event: BackendUserNotificationEvent,
		options: {
			channelFilter?: NotificationChannelFilter;
		} = {},
	): Promise<BackendUserNotificationPlanResult> {
		const emailPlanning = { completed: false };
		try {
			return await this.planCommentEvent(event, options, emailPlanning);
		} catch (error) {
			if (
				(!options.channelFilter || options.channelFilter.includes("email")) &&
				!emailPlanning.completed
			) {
				await this.recordDecision(event, "planning_failed", "failed").catch(
					() => undefined,
				);
			}
			throw error;
		}
	}

	private async planCommentEvent(
		event: BackendUserNotificationEvent,
		options: {
			channelFilter?: NotificationChannelFilter;
		},
		emailPlanning: { completed: boolean },
	): Promise<BackendUserNotificationPlanResult> {
		const emailRequested =
			!options.channelFilter || options.channelFilter.includes("email");
		const emailAlreadyDecided = emailRequested
			? Boolean(
					await this.emailDelivery.getDecision({
						commentId: event.commentId,
						flow: "site_staff_comment",
						eventKey: this.decisionEventKey(event),
					}),
				)
			: false;
		const shouldPlanEmail = emailRequested && !emailAlreadyDecided;
		const [settings] = await this.db
			.select({
				backendNotificationsEnabled: siteSettings.backendNotificationsEnabled,
			})
			.from(siteSettings)
			.where(eq(siteSettings.siteId, event.siteId))
			.limit(1);
		if (!settings?.backendNotificationsEnabled) {
			if (shouldPlanEmail) {
				await this.recordDecision(event, "site_backend_notifications_disabled");
			}
			return { tasks: [], deliveries: [], createdCount: 0 };
		}

		const adminEvent = resolveAdminEvent(event);
		if (!adminEvent) {
			if (shouldPlanEmail) {
				await this.recordDecision(
					event,
					event.source === "import" ||
						event.source === "migration" ||
						event.status === "spam"
						? "source_excluded"
						: "comment_event_not_applicable",
				);
			}
			return { tasks: [], deliveries: [], createdCount: 0 };
		}

		const recipients = shouldPlanEmail
			? await this.events.listActiveEmailRecipients({
					siteId: event.siteId,
					eventType: adminEvent,
				})
			: [];
		const tasks: TaskRunRecord[] = [];
		const deliveries: BackendUserNotificationPlanResult["deliveries"] = [];
		let createdCount = 0;

		if (shouldPlanEmail) {
			const systemSettings = await new RuntimeSystemSettingsService(
				this.db,
			).getSettings();
			if (!isSystemMailUsable(systemSettings.mail)) {
				await this.recordDecision(event, "system_email_unavailable");
			} else if (recipients.length === 0) {
				await this.recordDecision(event, "no_email_recipients");
			}
			let disabledRecipientCount = 0;
			let pausedRecipientCount = 0;
			let emailTaskCount = 0;
			for (const recipient of recipients) {
				if (!isSystemMailUsable(systemSettings.mail)) {
					break;
				}
				const channelConfigId = "email:default";
				const preference = await this.preferences.getPreference({
					userId: recipient.userId,
					channel: "email",
					channelConfigRef: channelConfigId,
				});
				if (!preference.enabled) {
					disabledRecipientCount += 1;
					continue;
				}
				if (
					preference.pausedUntil &&
					preference.pausedUntil > new Date().toISOString()
				) {
					pausedRecipientCount += 1;
					continue;
				}

				const key = idempotencyKey({
					commentId: event.commentId,
					targetIdentity: `user:${recipient.userId}`,
					channelConfigId,
					event: adminEvent,
				});
				if (preference.digestMode !== "off") {
					const existing = await this.tasks.getByIdempotencyKey(
						`digest:${key}`,
					);
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
							flow: "site_staff_comment",
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
					emailTaskCount += 1;
					if (!existing) {
						createdCount += 1;
					}
					continue;
				}

				const created = await this.tasks.createNotificationTaskWithDelivery({
					task: {
						type: taskTypeForEvent(adminEvent),
						siteId: event.siteId,
						siteKey: event.siteKey,
						subjectType: "comment",
						subjectId: event.commentId,
						idempotencyKey: key,
						maxAttempts: 3,
						payloadSummary: {
							event: adminEvent,
							flow: "site_staff_comment",
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
					},
					delivery: {
						channel: "email",
						channelConfigRef: channelConfigId,
						channelConfigNameSnapshot: "默认邮件",
						recipientType: "backend_user",
						recipientUserId: recipient.userId,
						recipientAddressSnapshot: recipient.email,
						recipientIdentityKey: `backend_user:${recipient.userId}:${channelConfigId}`,
						eventFamily: adminEvent,
						templateKey: templateKeyForEvent(adminEvent),
					},
				});
				tasks.push(created.task);
				emailTaskCount += 1;
				if (created.created) {
					createdCount += 1;
				}
				if (created.delivery) {
					deliveries.push({ ...created.delivery, event: adminEvent });
				}
			}
			if (
				isSystemMailUsable(systemSettings.mail) &&
				recipients.length > 0 &&
				emailTaskCount === 0
			) {
				await this.recordDecision(
					event,
					pausedRecipientCount > 0 && disabledRecipientCount === 0
						? "recipient_email_paused"
						: "recipient_email_disabled",
				);
			}
		}
		emailPlanning.completed = true;

		const externalChannels = await this.events.listExternalChannels({
			siteId: event.siteId,
			eventType: adminEvent,
		});

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
			createdCount += 1;
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
			createdCount,
		};
	}

	private recordDecision(
		event: BackendUserNotificationEvent,
		reasonCode: CommentEmailDecisionReason,
		status: "skipped" | "suppressed" | "failed" = "skipped",
	) {
		return this.emailDelivery.createDecision({
			siteId: event.siteId,
			siteKey: event.siteKey,
			commentId: event.commentId,
			flow: "site_staff_comment",
			eventKey: this.decisionEventKey(event),
			status,
			reasonCode,
			source: event.source,
		});
	}

	private decisionEventKey(event: BackendUserNotificationEvent): string {
		return [event.source, event.previousStatus ?? "none", event.status].join(
			":",
		);
	}
}
