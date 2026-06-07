export interface NotificationChannelSendInput {
	to: string;
	subject?: string;
	body: string;
	format: "html" | "text" | "json";
	headers?: Record<string, string>;
}

export interface ChannelSendResult {
	providerMessageId?: string | null;
}

export interface NotificationChannelAdapter {
	send(input: NotificationChannelSendInput): Promise<ChannelSendResult>;
}
