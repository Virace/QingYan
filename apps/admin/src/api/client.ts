export interface ApiErrorPayload {
	error?: {
		code?: string;
		message?: string;
		requestId?: string;
		details?: unknown;
	};
}

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

export async function requestJson<T>(
	pathname: string,
	init: RequestInit = {},
): Promise<T> {
	const headers = new Headers(init.headers);
	if (!headers.has("content-type") && init.body) {
		headers.set("content-type", "application/json");
	}

	const response = await fetch(pathname, {
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
