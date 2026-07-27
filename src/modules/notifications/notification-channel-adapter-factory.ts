import type { NotificationDeliveryRecord } from "../tasks/types";
import type { RuntimeSystemSettingsService } from "../system-settings/service";
import {
	defaultEmailChannelConfig,
	type NotificationChannelConfigsRepository,
} from "./channel-configs-repository";
import {
	EmailNotificationChannel,
	type EmailSender,
} from "./channels/email-channel";
import { NotificationChannelError } from "./channels/error-classifier";
import { createNodemailerSmtpSender } from "./channels/smtp-sender";
import type { NotificationChannelAdapter } from "./channels/types";
import {
	type NotificationFetch,
	WebhookNotificationChannel,
} from "./channels/webhook-channel";
import { WxPusherNotificationChannel } from "./channels/wxpusher-channel";

export interface NotificationChannelAdapterFactory {
	resolve(
		delivery: NotificationDeliveryRecord,
	): Promise<NotificationChannelAdapter | undefined>;
}

function readString(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function unavailableChannel(message: string): NotificationChannelAdapter {
	return {
		async send() {
			throw new NotificationChannelError("config", message);
		},
	};
}

export class RuntimeNotificationChannelAdapterFactory
	implements NotificationChannelAdapterFactory
{
	public constructor(
		private readonly input: {
			configs: NotificationChannelConfigsRepository;
			systemSettings: RuntimeSystemSettingsService;
			emailSender?: EmailSender;
			fetcher?: NotificationFetch;
		},
	) {}

	public async resolve(
		delivery: NotificationDeliveryRecord,
	): Promise<NotificationChannelAdapter | undefined> {
		const configRef =
			delivery.channelConfigRef ??
			(delivery.channel === "email" ? defaultEmailChannelConfig.id : null);
		if (!configRef) {
			return undefined;
		}
		const config = await this.input.configs.getRuntime(configRef);
		if (!config || config.type !== delivery.channel) {
			return undefined;
		}
		if (!config.enabled) {
			return unavailableChannel("Notification channel is disabled.");
		}

		if (config.type === "email") {
			const settings = await this.input.systemSettings.getSettings();
			const sender =
				this.input.emailSender ??
				createNodemailerSmtpSender(settings.mail.smtp);
			return new EmailNotificationChannel(
				{
					enabled: settings.mail.enabled,
					smtp: {
						host: settings.mail.smtp.host,
						from: settings.mail.smtp.from,
						username: settings.mail.smtp.username,
						password: settings.mail.smtp.password,
					},
				},
				sender,
			);
		}

		if (config.type === "webhook") {
			return new WebhookNotificationChannel(
				{
					enabled: config.enabled,
					url: readString(config.config, "url") ?? "",
					secret: readString(config.secretConfig, "secret"),
				},
				this.input.fetcher,
			);
		}

		return new WxPusherNotificationChannel(
			{
				enabled: config.enabled,
				appToken: readString(config.secretConfig, "appToken"),
				apiUrl: readString(config.config, "apiUrl"),
			},
			this.input.fetcher,
		);
	}
}
