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

let adminCsrfHeader = "x-qingyan-csrf-token";
let adminCsrfToken: string | null = null;

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
