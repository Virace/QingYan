export type ApiFieldError = {
	path: string;
	code?: string;
	expected?: string;
	received?: string;
	message: string;
};

export interface ApiErrorPayload {
	error?: {
		code?: string;
		message?: string;
		requestId?: string;
		fields?: ApiFieldError[];
		details?: unknown;
	};
}

export interface AdminApiErrorLogContext {
	operation?: "query" | "mutation" | "request" | "ui";
	label?: string;
	queryKey?: unknown;
	mutationKey?: unknown;
}

let adminCsrfHeader = "x-qingyan-csrf-token";
let adminCsrfToken: string | null = null;

const sensitiveKeyPattern =
	/(authorization|cookie|csrf|password|token|secret|credential|api[-_]?key|private[-_]?key)/iu;
const chineseTextPattern = /\p{Script=Han}/u;

declare global {
	interface Window {
		__QINGYAN_ADMIN__?: {
			basePath?: string;
			apiBase?: string;
		};
	}
}

type AdminRuntimeGlobal = typeof globalThis & {
	__QINGYAN_ADMIN__?: Window["__QINGYAN_ADMIN__"];
};

export class ApiError extends Error {
	public readonly requestId?: string;
	public readonly fields: ApiFieldError[];
	public readonly details?: unknown;

	public constructor(
		message: string,
		public readonly statusCode: number,
		public readonly code?: string,
		public readonly payload?: unknown,
	) {
		super(message);
		const errorPayload = payload as ApiErrorPayload | undefined;
		this.requestId = errorPayload?.error?.requestId;
		this.fields = errorPayload?.error?.fields ?? [];
		this.details = errorPayload?.error?.details;
	}
}

function hasChineseText(value: string): boolean {
	return chineseTextPattern.test(value);
}

export function adminUiErrorMessage(
	error: unknown,
	fallback = "操作失败，请查看控制台错误详情。",
): string {
	if (typeof error === "string") {
		const message = error.trim();
		return message && hasChineseText(message) ? message : fallback;
	}
	if (error instanceof ApiError) {
		const message = error.message.trim();
		return message && hasChineseText(message) ? message : fallback;
	}
	return fallback;
}

function sanitizeForConsole(value: unknown, depth = 0): unknown {
	if (depth > 4) {
		return "[已省略]";
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeForConsole(item, depth + 1));
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	const sanitized: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (sensitiveKeyPattern.test(key)) {
			sanitized[key] = "[已隐藏]";
			continue;
		}
		sanitized[key] = sanitizeForConsole(item, depth + 1);
	}
	return sanitized;
}

export function logAdminApiError(
	error: unknown,
	context: AdminApiErrorLogContext = {},
): void {
	if (error instanceof ApiError) {
		console.error("QingYan Admin API error", {
			context: sanitizeForConsole(context),
			statusCode: error.statusCode,
			code: error.code,
			requestId: error.requestId,
			message: error.message,
			fields: sanitizeForConsole(error.fields),
			details: sanitizeForConsole(error.details),
		});
		return;
	}
	if (error instanceof Error) {
		console.error("QingYan Admin API error", {
			context: sanitizeForConsole(context),
			name: error.name,
			message: error.message,
			stack: error.stack,
		});
		return;
	}
	console.error("QingYan Admin API error", {
		context: sanitizeForConsole(context),
		error: sanitizeForConsole(error),
	});
}

export function updateAdminCsrf(input: {
	header?: string;
	token?: string | null;
}): void {
	if (input.header) {
		adminCsrfHeader = input.header;
	}
	adminCsrfToken = input.token ?? null;
}

export function clearAdminCsrf(): void {
	adminCsrfToken = null;
}

function resolveRequestPath(pathname: string): string {
	if (!pathname.startsWith("/api/")) {
		return pathname;
	}
	const apiBase =
		(globalThis as AdminRuntimeGlobal).__QINGYAN_ADMIN__?.apiBase ?? "/api";
	return `${apiBase.replace(/\/+$/u, "")}${pathname.slice("/api".length)}`;
}

export async function requestJson<T>(
	pathname: string,
	init: RequestInit = {},
): Promise<T> {
	const headers = new Headers(init.headers);
	if (!headers.has("content-type") && init.body) {
		headers.set("content-type", "application/json");
	}
	if (
		adminCsrfToken &&
		["POST", "PUT", "PATCH", "DELETE"].includes(
			(init.method ?? "GET").toUpperCase(),
		)
	) {
		headers.set(adminCsrfHeader, adminCsrfToken);
	}

	const response = await fetch(resolveRequestPath(pathname), {
		credentials: "include",
		...init,
		headers,
	});
	const contentType = response.headers.get("content-type") ?? "";
	const payload = contentType.includes("application/json")
		? ((await response.json()) as ApiErrorPayload | T)
		: await response.text();

	if (!response.ok) {
		const errorPayload = payload as ApiErrorPayload;
		throw new ApiError(
			errorPayload.error?.message ?? "请求失败。",
			response.status,
			errorPayload.error?.code,
			payload,
		);
	}

	return payload as T;
}
