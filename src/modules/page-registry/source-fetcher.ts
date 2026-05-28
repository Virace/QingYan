import { AppError } from "../shared/errors";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export interface FetchPageSourceTextOptions {
	timeoutMs?: number;
	maxBytes?: number;
}

export async function fetchPageSourceText(
	url: string,
	options: FetchPageSourceTextOptions = {},
): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
	try {
		const response = await fetch(url, {
			redirect: "follow",
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new AppError(
				502,
				"PAGE_SOURCE_FETCH_FAILED",
				`页面来源拉取失败：${response.status}`,
			);
		}
		const text = await response.text();
		if (
			new TextEncoder().encode(text).byteLength >
			(options.maxBytes ?? DEFAULT_MAX_BYTES)
		) {
			throw new AppError(
				413,
				"PAGE_SOURCE_TOO_LARGE",
				"页面来源内容超过大小限制。",
			);
		}
		return text;
	} finally {
		clearTimeout(timeout);
	}
}
