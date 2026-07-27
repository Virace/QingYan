import type { AppDatabase } from "../../db/client";
import { BackendUserNotificationRecipientsRepository } from "../notifications/backend-user-recipients-repository";
import {
	channelTargetSnapshot,
	NotificationChannelConfigsRepository,
	type NotificationChannelConfigRecord,
} from "../notifications/channel-configs-repository";
import { TaskEventLogRepository } from "./task-event-log-repository";
import { parseTaskFailureRecipientUserId } from "./task-failure-notification-targets";
import { TaskRunRepository } from "./task-run-repository";
import type { TaskRunRecord } from "./types";

export interface TaskFailureNotificationPolicy {
	enabled: boolean;
	channelConfigIds: string[];
	recipientIds: string[];
}

function readFailureNotificationPolicy(
	run: TaskRunRecord,
): TaskFailureNotificationPolicy {
	const snapshot =
		run.actionConfigSnapshot && typeof run.actionConfigSnapshot === "object"
			? (run.actionConfigSnapshot as Record<string, unknown>)
			: {};
	const policy =
		snapshot.policy && typeof snapshot.policy === "object"
			? (snapshot.policy as Record<string, unknown>)
			: {};
	const failureNotification =
		policy.failureNotification && typeof policy.failureNotification === "object"
			? (policy.failureNotification as Record<string, unknown>)
			: {};
	return {
		enabled: failureNotification.enabled === true,
		channelConfigIds: Array.isArray(failureNotification.channelConfigIds)
			? failureNotification.channelConfigIds.filter(
					(item): item is string => typeof item === "string" && item.length > 0,
				)
			: [],
		recipientIds: Array.isArray(failureNotification.recipientIds)
			? failureNotification.recipientIds.filter(
					(item): item is string => typeof item === "string" && item.length > 0,
				)
			: [],
	};
}

export class TaskFailureNotificationService {
	private readonly recipients: BackendUserNotificationRecipientsRepository;
	private readonly channelConfigs: NotificationChannelConfigsRepository;
	private readonly taskRuns: TaskRunRepository;
	private readonly eventLogs: TaskEventLogRepository;

	public constructor(db: AppDatabase) {
		this.recipients = new BackendUserNotificationRecipientsRepository(db);
		this.channelConfigs = new NotificationChannelConfigsRepository(db);
		this.taskRuns = new TaskRunRepository(db);
		this.eventLogs = new TaskEventLogRepository(db);
	}

	public async planForFailedRun(run: TaskRunRecord) {
		const policy = readFailureNotificationPolicy(run);
		if (!policy.enabled) {
			return { createdCount: 0, taskRunIds: [], deliveryIds: [] };
		}
		if (!run.siteId || !run.siteKey) {
			await this.writeFailureEvent(run, "site_scope_required", {
				siteId: run.siteId,
				siteKey: run.siteKey,
			});
			return { createdCount: 0, taskRunIds: [], deliveryIds: [] };
		}
		if (policy.channelConfigIds.length === 0) {
			await this.writeFailureEvent(run, "empty_failure_notification_targets", {
				channelConfigIds: policy.channelConfigIds,
				recipientIds: policy.recipientIds,
			});
			return { createdCount: 0, taskRunIds: [], deliveryIds: [] };
		}

		const selectedConfigs = (
			await this.channelConfigs.listByIds(policy.channelConfigIds)
		).filter((config) => config.enabled);
		const directUserIds = policy.recipientIds.flatMap((recipientId) => {
			const userId = parseTaskFailureRecipientUserId(recipientId);
			return userId ? [userId] : [];
		});
		const legacyRecipientIds = policy.recipientIds.filter(
			(recipientId) => parseTaskFailureRecipientUserId(recipientId) === null,
		);
		const legacyRecipients =
			legacyRecipientIds.length > 0
				? await this.recipients.listSiteRecipients(run.siteId)
				: [];
		const legacyUserIds = legacyRecipients
			.filter(
				(recipient) =>
					recipient.enabled && legacyRecipientIds.includes(recipient.id),
			)
			.map((recipient) => recipient.userId);
		const activeUsers = await this.recipients.listActiveSiteRecipientUsers({
			siteId: run.siteId,
			userIds: Array.from(new Set([...directUserIds, ...legacyUserIds])),
		});
		const taskRunIds: string[] = [];
		const deliveryIds: string[] = [];
		const skipped: Array<{ target: string; channelConfigId: string }> = [];

		const createTarget = async (input: {
			config: NotificationChannelConfigRecord;
			recipientType: "backend_user" | "external_target";
			recipientUserId: number | null;
			recipientAddress: string;
			identityKey: string;
		}) => {
			const notificationRun = await this.taskRuns.create({
				type: "task_failure_notification",
				category: "notification",
				siteId: run.siteId,
				siteKey: run.siteKey,
				subjectType: "task_run",
				subjectId: run.id,
				idempotencyKey: [
					"task_failure_notification",
					run.id,
					input.identityKey,
				].join(":"),
				payloadSummary: {
					event: "task_run_failed",
					taskRunId: run.id,
					scheduledTaskId: run.scheduledTaskId,
					scheduledTaskName: run.scheduledTaskNameSnapshot,
					taskType: run.type,
					userId: input.recipientUserId,
					channelConfigId: input.config.id,
					channelConfigName: input.config.name,
				},
				payload: {
					format: "text",
					subjectTemplate: "[QingYan] 任务运行失败",
					bodyTemplate:
						"任务 {{task.name}} 运行失败。\n类型：{{task.type}}\n运行 ID：{{run.id}}\n状态：{{run.status}}\n错误：{{run.error}}",
					templateContext: {
						task: {
							id: run.scheduledTaskId,
							name: run.scheduledTaskNameSnapshot ?? run.type,
							type: run.type,
						},
						run: {
							id: run.id,
							status: run.status,
							error: JSON.stringify(run.error ?? {}),
						},
					},
				},
			});
			const delivery = await this.taskRuns.createDelivery({
				taskRunId: notificationRun.id,
				channel: input.config.type,
				channelConfigRef: input.config.id,
				channelConfigNameSnapshot: input.config.name,
				recipientType: input.recipientType,
				recipientUserId: input.recipientUserId,
				recipientAddressSnapshot: input.recipientAddress,
				recipientIdentityKey: input.identityKey,
				eventFamily: "task_run_failed",
				templateKey: "task.failure",
			});
			taskRunIds.push(notificationRun.id);
			deliveryIds.push(delivery.id);
		};

		for (const config of selectedConfigs) {
			if (config.type === "email") {
				if (activeUsers.length === 0) {
					skipped.push({
						target: "email_recipients",
						channelConfigId: config.id,
					});
					continue;
				}
				for (const user of activeUsers) {
					await createTarget({
						config,
						recipientType: "backend_user",
						recipientUserId: user.id,
						recipientAddress: channelTargetSnapshot(config, user.email),
						identityKey: `backend_user:${user.id}:${config.id}`,
					});
				}
			} else {
				await createTarget({
					config,
					recipientType: "external_target",
					recipientUserId: null,
					recipientAddress: channelTargetSnapshot(config),
					identityKey: `external_target:${config.id}`,
				});
			}
		}

		if (taskRunIds.length > 0) {
			await this.eventLogs.append({
				taskRunId: run.id,
				eventType: "task_failure_notification_enqueued",
				level: "info",
				message: "Task failure notification enqueued.",
				data: { taskRunIds, deliveryIds },
				visibleToSiteAdmin: false,
			});
		}
		if (taskRunIds.length === 0 || skipped.length > 0) {
			await this.writeFailureEvent(run, "no_valid_failure_notification_route", {
				skipped,
				channelConfigIds: policy.channelConfigIds,
				recipientIds: policy.recipientIds,
			});
		}
		return { createdCount: taskRunIds.length, taskRunIds, deliveryIds };
	}

	private async writeFailureEvent(
		run: TaskRunRecord,
		reason: string,
		data?: unknown,
	) {
		await this.eventLogs.append({
			taskRunId: run.id,
			eventType: "task_failure_notification_failed",
			level: "warn",
			message: "Task failure notification was not enqueued.",
			data: { reason, data },
			visibleToSiteAdmin: false,
		});
	}
}
