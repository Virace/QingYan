import type { AuthenticatedAdminSession } from "../admin/session-service";
import type { TaskRunRepository } from "../tasks/task-run-repository";
import type { TaskQueue } from "../tasks/types";
import {
	channelTargetSnapshot,
	defaultEmailChannelConfig,
	type NotificationChannelConfigRecord,
	type NotificationChannelConfigsRepository,
} from "./channel-configs-repository";

export type NotificationChannel = "email" | "webhook" | "wxpusher";

export class NotificationChannelTestService {
	public constructor(
		private readonly queue: TaskQueue,
		private readonly repository: TaskRunRepository,
		private readonly configs: NotificationChannelConfigsRepository,
	) {}

	public async enqueue(input: {
		channel?: NotificationChannel;
		channelConfigId?: string;
		recipient?: string;
		siteKey?: string;
		session: AuthenticatedAdminSession;
	}) {
		const config = await this.resolveConfig(input);
		const recipient =
			input.recipient ??
			channelTargetSnapshot(config, input.session.user.email);
		const task = await this.queue.enqueue({
			type: "channel_test",
			category: "notification",
			payload: {
				channel: config.type,
				channelConfigId: config.id,
				channelConfigName: config.name,
				templateContext: {
					site: { name: "QingYan" },
					comment: { content: "channel test" },
				},
				subjectTemplate: "[{{site.name}}] 通道测试",
				bodyTemplate: "这是一条 QingYan 通知通道测试消息。",
				format: config.type === "webhook" ? "json" : "text",
			},
			payloadSummary: {
				channel: config.type,
				channelConfigId: config.id,
				channelConfigName: config.name,
				recipientType: "test",
				recipientAddressSnapshot: recipient,
			},
			siteKey: input.siteKey ?? null,
			actorType: "admin_user",
			actorId: String(input.session.user.id),
			maxAttempts: 1,
		});
		const delivery = await this.repository.createNotificationDelivery({
			taskRunId: task.id,
			channel: config.type,
			channelConfigRef: config.id,
			channelConfigNameSnapshot: config.name,
			recipientType: "test",
			recipientUserId: input.session.user.id,
			recipientAddressSnapshot: recipient,
			recipientIdentityKey: recipient,
			eventFamily: "channel_test",
			templateKey: "channel_test",
		});
		return {
			taskId: task.id,
			deliveryId: delivery.id,
			queueBackend: task.queueBackend,
			channelConfigId: config.id,
			channelType: config.type,
			channelName: config.name,
			channel: config.type,
			recipient,
		};
	}

	private async resolveConfig(input: {
		channel?: NotificationChannel;
		channelConfigId?: string;
	}): Promise<NotificationChannelConfigRecord> {
		const id =
			input.channelConfigId ??
			(input.channel === "email"
				? defaultEmailChannelConfig.id
				: input.channel);
		const config = id ? await this.configs.get(id) : null;
		if (!config) {
			throw new Error(`Notification channel config not found: ${id ?? "-"}`);
		}
		return config;
	}
}
