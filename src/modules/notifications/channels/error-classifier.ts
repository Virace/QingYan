export type NotificationChannelErrorKind =
	| "config"
	| "temporary"
	| "recipient_permanent"
	| "provider_auth"
	| "template";

export interface ClassifiedNotificationError {
	kind: NotificationChannelErrorKind;
	message: string;
	terminal: boolean;
	affectsRecipientReputation: boolean;
}

export class NotificationChannelError extends Error {
	public constructor(
		public readonly kind: NotificationChannelErrorKind,
		message: string,
	) {
		super(message);
		this.name = "NotificationChannelError";
	}
}

export function classifyChannelError(
	error: unknown,
): ClassifiedNotificationError {
	if (error instanceof NotificationChannelError) {
		return fromKind(error.kind, error.message);
	}

	const statusCode =
		typeof error === "object" && error && "statusCode" in error
			? Number((error as { statusCode: unknown }).statusCode)
			: undefined;
	if (statusCode) {
		if (statusCode >= 500 || statusCode === 408 || statusCode === 429) {
			return fromKind("temporary", `Provider status ${statusCode}`);
		}
		if ([401, 403, 404].includes(statusCode)) {
			return fromKind("provider_auth", `Provider status ${statusCode}`);
		}
	}

	const message = error instanceof Error ? error.message : String(error);
	if (/timeout|network|ECONN|fetch failed/iu.test(message)) {
		return fromKind("temporary", message);
	}
	return fromKind("temporary", message);
}

function fromKind(
	kind: NotificationChannelErrorKind,
	message: string,
): ClassifiedNotificationError {
	return {
		kind,
		message,
		terminal: kind !== "temporary",
		affectsRecipientReputation: kind === "recipient_permanent",
	};
}
