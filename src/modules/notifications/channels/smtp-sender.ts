import nodemailer from "nodemailer";

import type { SystemSettings } from "../../system-settings/definitions";
import type { EmailSender } from "./email-channel";
import { NotificationChannelError } from "./error-classifier";

export type SmtpErrorKind =
	| "configuration"
	| "authentication"
	| "network"
	| "tls"
	| "provider"
	| "unknown";

export interface ClassifiedSmtpError {
	kind: SmtpErrorKind;
	message: string;
}

type NodemailerResponse = {
	messageId?: string;
	response?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object");
}

function errorCode(error: unknown) {
	return isRecord(error) && typeof error.code === "string"
		? error.code
		: undefined;
}

function errorCommand(error: unknown) {
	return isRecord(error) && typeof error.command === "string"
		? error.command
		: undefined;
}

export function classifySmtpError(error: unknown): ClassifiedSmtpError {
	if (error instanceof NotificationChannelError) {
		return {
			kind: error.kind === "config" ? "configuration" : "provider",
			message: error.message,
		};
	}

	const code = errorCode(error);
	const command = errorCommand(error);
	const message = error instanceof Error ? error.message : String(error);
	if (
		code === "EAUTH" ||
		command === "AUTH" ||
		/invalid login|auth|authentication|credentials/iu.test(message)
	) {
		return { kind: "authentication", message: "SMTP authentication failed." };
	}
	if (
		code === "ETIMEDOUT" ||
		code === "ECONNECTION" ||
		code === "ECONNREFUSED" ||
		code === "ECONNRESET" ||
		code === "ENOTFOUND" ||
		code === "EAI_AGAIN" ||
		/network|timeout|connection|connect/iu.test(message)
	) {
		return { kind: "network", message: "SMTP network connection failed." };
	}
	if (
		code === "ESOCKET" ||
		/tls|ssl|certificate|cert|self signed|handshake/iu.test(message)
	) {
		return { kind: "tls", message: "SMTP TLS negotiation failed." };
	}
	if (code === "EENVELOPE" || code === "EMESSAGE") {
		return { kind: "configuration", message: "SMTP message is invalid." };
	}
	if (code || /smtp|provider|response|rejected/iu.test(message)) {
		return { kind: "provider", message: "SMTP provider rejected the message." };
	}
	return { kind: "unknown", message: "SMTP delivery failed." };
}

export function sanitizeSmtpError(
	error: ClassifiedSmtpError,
	password?: string,
): ClassifiedSmtpError {
	const trimmedPassword = password?.trim();
	if (!trimmedPassword) {
		return error;
	}
	return {
		...error,
		message: error.message.split(trimmedPassword).join("[redacted]"),
	};
}

export function createNodemailerSmtpSender(
	settings: SystemSettings["mail"]["smtp"],
): EmailSender {
	return async (input) => {
		const auth =
			settings.username.trim() || settings.password?.trim()
				? {
						user: settings.username,
						pass: settings.password,
					}
				: undefined;
		const transporter = nodemailer.createTransport({
			host: settings.host,
			port: settings.port,
			secure: settings.secure,
			auth,
		});
		const result = (await transporter.sendMail({
			from: input.from,
			to: input.to,
			subject: input.subject,
			text: input.format === "html" ? undefined : input.body,
			html: input.format === "html" ? input.body : undefined,
		})) as NodemailerResponse;
		return { providerMessageId: result.messageId ?? result.response ?? null };
	};
}
