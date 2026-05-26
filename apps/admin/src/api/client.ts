export interface ApiErrorPayload {
	error?: {
		code?: string;
		message?: string;
		requestId?: string;
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
	public constructor(
		message: string,
		public readonly statusCode: number,
		public readonly code?: string,
		public readonly payload?: unknown,
	) {
		super(message);
	}
}

function isAdminWriteMethod(method: string): boolean {
	return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

function isCsrfError(statusCode: number, code?: string): boolean {
	return (
		statusCode === 403 &&
		(code === "ADMIN_CSRF_REQUIRED" || code === "ADMIN_CSRF_INVALID")
	);
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

async function refreshAdminCsrf(): Promise<boolean> {
	const response = await fetch(resolveRequestPath("/api/admin/session/me"), {
		credentials: "include",
	});
	const contentType = response.headers.get("content-type") ?? "";
	const payload = contentType.includes("application/json")
		? ((await response.json()) as ApiErrorPayload | { csrf?: unknown })
		: null;

	if (!response.ok) {
		return false;
	}

	const csrf = (payload as { csrf?: { header?: string; token?: string } }).csrf;
	if (!csrf?.token) {
		return false;
	}

	updateAdminCsrf(csrf);
	return true;
}

export async function requestJson<T>(
	pathname: string,
	init: RequestInit = {},
): Promise<T> {
	const method = (init.method ?? "GET").toUpperCase();
	const headers = new Headers(init.headers);
	if (!headers.has("content-type") && init.body) {
		headers.set("content-type", "application/json");
	}
	if (adminCsrfToken && isAdminWriteMethod(method)) {
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
		if (
			isAdminWriteMethod(method) &&
			isCsrfError(response.status, errorPayload.error?.code) &&
			(await refreshAdminCsrf())
		) {
			const retryHeaders = new Headers(init.headers);
			if (!retryHeaders.has("content-type") && init.body) {
				retryHeaders.set("content-type", "application/json");
			}
			if (adminCsrfToken) {
				retryHeaders.set(adminCsrfHeader, adminCsrfToken);
			}
			const retryResponse = await fetch(resolveRequestPath(pathname), {
				credentials: "include",
				...init,
				headers: retryHeaders,
			});
			const retryContentType = retryResponse.headers.get("content-type") ?? "";
			const retryPayload = retryContentType.includes("application/json")
				? ((await retryResponse.json()) as ApiErrorPayload | T)
				: await retryResponse.text();

			if (retryResponse.ok) {
				return retryPayload as T;
			}

			const retryErrorPayload = retryPayload as ApiErrorPayload;
			throw new ApiError(
				retryErrorPayload.error?.message ?? "请求失败。",
				retryResponse.status,
				retryErrorPayload.error?.code,
				retryPayload,
			);
		}
		throw new ApiError(
			errorPayload.error?.message ?? "请求失败。",
			response.status,
			errorPayload.error?.code,
			payload,
		);
	}

	return payload as T;
}
