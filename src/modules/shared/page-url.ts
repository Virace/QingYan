import { z } from "zod";

function isAbsoluteHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

export const pageUrlInputSchema = z
	.string()
	.min(1)
	.refine((value) => value.startsWith("/") || isAbsoluteHttpUrl(value), {
		message: "pageUrl 必须是 http(s) 完整地址或以 / 开头的页面路径。",
	});

export function normalizePagePath(value?: string | null): string | undefined {
	if (!value) {
		return undefined;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	try {
		if (trimmed.startsWith("/")) {
			return new URL(trimmed, "http://qingyan.local").pathname;
		}

		return new URL(trimmed).pathname;
	} catch {
		return trimmed.startsWith("/") ? trimmed : undefined;
	}
}

export function resolvePublicPageUrl(
	pageUrl: string | null | undefined,
	allowedOrigins: string[],
): string | null {
	if (!pageUrl) {
		return null;
	}

	const trimmed = pageUrl.trim();
	const normalizedPath = normalizePagePath(trimmed);
	if (!normalizedPath) {
		return trimmed;
	}

	const primaryOrigin = allowedOrigins[0];
	if (!primaryOrigin) {
		return isAbsoluteHttpUrl(trimmed) ? trimmed : normalizedPath;
	}

	try {
		return new URL(normalizedPath, primaryOrigin).toString();
	} catch {
		return normalizedPath;
	}
}
