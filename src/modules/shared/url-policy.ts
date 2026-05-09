import { AppError } from "./errors";

function parseUrl(value: string): URL {
	return new URL(value);
}

export function isSafeHttpUrl(value: string): boolean {
	try {
		const parsed = parseUrl(value.trim());
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

export function normalizeSafeHttpUrl(value: string): string {
	const trimmed = value.trim();
	if (!isSafeHttpUrl(trimmed)) {
		throw new AppError(
			400,
			"COMMENT_WEBSITE_URL_INVALID",
			"URL 仅允许 http(s)。",
		);
	}

	return parseUrl(trimmed).toString();
}

export function sanitizeOptionalSafeHttpUrl(
	value?: string | null,
): string | undefined {
	if (!value) {
		return undefined;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	try {
		return normalizeSafeHttpUrl(trimmed);
	} catch {
		return undefined;
	}
}

export function normalizeOrigin(value: string): string {
	const trimmed = value.trim();
	let parsed: URL;
	try {
		parsed = parseUrl(trimmed);
	} catch {
		throw new AppError(
			400,
			"INVALID_REQUEST",
			"allowedOrigins 必须是合法 origin。",
		);
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new AppError(
			400,
			"INVALID_REQUEST",
			"allowedOrigins 仅允许 http 或 https。",
		);
	}
	if (parsed.username || parsed.password) {
		throw new AppError(
			400,
			"INVALID_REQUEST",
			"allowedOrigins 不能包含用户名或密码。",
		);
	}
	if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
		throw new AppError(
			400,
			"INVALID_REQUEST",
			"allowedOrigins 必须是纯 origin，不能包含路径、查询或片段。",
		);
	}

	return parsed.origin;
}

export function normalizeOriginList(values: string[]): string[] {
	const result: string[] = [];
	for (const value of values) {
		const normalized = normalizeOrigin(value);
		if (!result.includes(normalized)) {
			result.push(normalized);
		}
	}
	return result;
}
