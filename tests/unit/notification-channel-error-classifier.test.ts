import { describe, expect, it } from "vitest";

import {
	classifyChannelError,
	NotificationChannelError,
} from "../../src/modules/notifications/channels/error-classifier";

describe("notification channel error classifier", () => {
	it("classifies config, temporary, auth, recipient, and template failures", () => {
		expect(
			classifyChannelError(new NotificationChannelError("config", "missing")),
		).toMatchObject({
			kind: "config",
			terminal: true,
			affectsRecipientReputation: false,
		});
		expect(
			classifyChannelError(
				new NotificationChannelError("temporary", "timeout"),
			),
		).toMatchObject({
			kind: "temporary",
			terminal: false,
			affectsRecipientReputation: false,
		});
		expect(
			classifyChannelError(
				new NotificationChannelError("provider_auth", "forbidden"),
			),
		).toMatchObject({
			kind: "provider_auth",
			terminal: true,
			affectsRecipientReputation: false,
		});
		expect(
			classifyChannelError(
				new NotificationChannelError("template", "bad json"),
			),
		).toMatchObject({
			kind: "template",
			terminal: true,
			affectsRecipientReputation: false,
		});
		expect(
			classifyChannelError(
				new NotificationChannelError("recipient_permanent", "mailbox"),
			),
		).toMatchObject({
			kind: "recipient_permanent",
			terminal: true,
			affectsRecipientReputation: true,
		});
	});

	it("maps provider status codes and network errors", () => {
		expect(classifyChannelError({ statusCode: 500 })).toMatchObject({
			kind: "temporary",
			terminal: false,
		});
		expect(classifyChannelError({ statusCode: 403 })).toMatchObject({
			kind: "provider_auth",
			terminal: true,
		});
		expect(classifyChannelError(new Error("network timeout"))).toMatchObject({
			kind: "temporary",
			terminal: false,
		});
	});
});
