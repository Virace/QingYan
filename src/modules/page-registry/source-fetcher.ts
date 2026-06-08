import { AppError } from "../shared/errors";
import { safeFetchText } from "../shared/server-safe-fetch";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export interface FetchPageSourceTextOptions {
	allowedOrigins: string[];
	timeoutMs?: number;
	maxBytes?: number;
}

export async function fetchPageSourceText(
	url: string,
	options: FetchPageSourceTextOptions,
): Promise<string> {
	const response = await safeFetchText(url, {
		allowedOrigins: options.allowedOrigins,
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
	});
	if (response.status < 200 || response.status >= 300) {
		throw new AppError(
			502,
			"PAGE_SOURCE_FETCH_FAILED",
			`页面来源拉取失败：${response.status}`,
		);
	}
	return response.text;
}
