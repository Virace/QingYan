import { NotificationChannelError } from "./error-classifier";
import type {
	ChannelSendResult,
	NotificationChannelAdapter,
	NotificationChannelSendInput,
} from "./types";
import type { NotificationFetch } from "./webhook-channel";

export class WxPusherNotificationChannel implements NotificationChannelAdapter {
	public constructor(
		private readonly settings: {
			enabled: boolean;
			appToken?: string;
			apiUrl?: string;
		},
		private readonly fetcher: NotificationFetch = fetch,
	) {}

	public async send(
		input: NotificationChannelSendInput,
	): Promise<ChannelSendResult> {
		if (!this.settings.enabled || !this.settings.appToken) {
			throw new NotificationChannelError(
				"config",
				"WxPusher app token is required.",
			);
		}
		const response = await this.fetcher(
			this.settings.apiUrl ?? "https://wxpusher.zjiecode.com/api/send/message",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					appToken: this.settings.appToken,
					content: input.body,
					summary: input.subject,
					contentType: input.format === "html" ? 2 : 1,
					uids: [input.to],
				}),
			},
		);
		if (response.status >= 400) {
			throw { statusCode: response.status };
		}
		return { providerMessageId: null };
	}
}
