import { NotificationChannelError } from "./error-classifier";
import type {
	ChannelSendResult,
	NotificationChannelAdapter,
	NotificationChannelSendInput,
} from "./types";

export type NotificationFetch = (
	url: string,
	init: {
		method: string;
		headers: Record<string, string>;
		body: string;
	},
) => Promise<{ status: number; text?: () => Promise<string> }>;

export class WebhookNotificationChannel implements NotificationChannelAdapter {
	public constructor(
		private readonly settings: {
			enabled: boolean;
			url: string;
			secret?: string;
		},
		private readonly fetcher: NotificationFetch = fetch,
	) {}

	public async send(
		input: NotificationChannelSendInput,
	): Promise<ChannelSendResult> {
		if (!this.settings.enabled || !this.settings.url) {
			throw new NotificationChannelError("config", "Webhook URL is required.");
		}
		const response = await this.fetcher(this.settings.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(this.settings.secret
					? { "x-qingyan-webhook-token": this.settings.secret }
					: {}),
			},
			body: input.body,
		});
		if (response.status >= 400) {
			throw { statusCode: response.status };
		}
		return { providerMessageId: null };
	}
}
