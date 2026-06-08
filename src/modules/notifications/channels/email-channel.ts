import { NotificationChannelError } from "./error-classifier";
import type {
	ChannelSendResult,
	NotificationChannelAdapter,
	NotificationChannelSendInput,
} from "./types";

export interface EmailChannelSettings {
	enabled: boolean;
	smtp: {
		host: string;
		from: string;
		username?: string;
		password?: string;
	};
}

export type EmailSender = (
	input: NotificationChannelSendInput & { from: string },
) => Promise<ChannelSendResult>;

export class EmailNotificationChannel implements NotificationChannelAdapter {
	public constructor(
		private readonly settings: EmailChannelSettings,
		private readonly sender: EmailSender,
	) {}

	public async send(input: NotificationChannelSendInput) {
		if (
			!this.settings.enabled ||
			!this.settings.smtp.host ||
			!this.settings.smtp.from
		) {
			throw new NotificationChannelError(
				"config",
				"SMTP host and from address are required.",
			);
		}
		return this.sender({
			...input,
			from: this.settings.smtp.from,
		});
	}
}
