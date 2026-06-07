export type NotificationTemplateFormat = "html" | "text" | "json";

export class NotificationTemplateError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "NotificationTemplateError";
	}
}

export interface RenderNotificationTemplateInput {
	format: NotificationTemplateFormat;
	subjectTemplate?: string | null;
	bodyTemplate: string;
	context: Record<string, unknown>;
}

function getPathValue(context: Record<string, unknown>, path: string): unknown {
	let value: unknown = context;
	for (const part of path.split(".")) {
		if (!value || typeof value !== "object" || !(part in value)) {
			throw new NotificationTemplateError(`Missing template variable: ${path}`);
		}
		value = (value as Record<string, unknown>)[part];
	}
	if (value === undefined || value === null) {
		throw new NotificationTemplateError(`Missing template variable: ${path}`);
	}
	return value;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function sanitizeHeader(value: string): string {
	return value.replace(/[\r\n]+/gu, " ").trim();
}

function renderTemplate(
	template: string,
	context: Record<string, unknown>,
	format: NotificationTemplateFormat,
): string {
	return template.replace(
		/\{\{\s*(json\s+)?([a-zA-Z0-9_.]+)\s*\}\}/gu,
		(_match, jsonPrefix: string | undefined, path: string) => {
			const value = getPathValue(context, path);
			if (jsonPrefix) {
				return JSON.stringify(value);
			}
			const text = String(value);
			return format === "html" ? escapeHtml(text) : text;
		},
	);
}

export function renderNotificationTemplate(
	input: RenderNotificationTemplateInput,
) {
	const subject = input.subjectTemplate
		? sanitizeHeader(
				renderTemplate(input.subjectTemplate, input.context, "text"),
			)
		: undefined;
	const body = renderTemplate(input.bodyTemplate, input.context, input.format);

	if (input.format === "json") {
		try {
			JSON.parse(body);
		} catch (error) {
			throw new NotificationTemplateError(
				`Rendered notification JSON is invalid: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	return { subject, body };
}
