import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { AppError } from "./errors";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

export interface ServerSafeFetchOptions {
	allowedOrigins: string[];
	timeoutMs?: number;
	maxBytes?: number;
	maxRedirects?: number;
	fetchImpl?: typeof fetch;
	lookupHost?: (
		hostname: string,
	) => Promise<Array<{ address: string; family: 4 | 6 }>>;
}

export interface ServerSafeFetchTextResult {
	status: number;
	url: string;
	text: string;
}

function parseFetchUrl(value: string): URL {
	try {
		return new URL(value);
	} catch {
		throw new AppError(
			400,
			"SERVER_FETCH_URL_INVALID",
			"服务器拉取 URL 无效。",
		);
	}
}

function normalizeAllowedOrigins(origins: string[]): string[] {
	return origins.map((origin) => parseFetchUrl(origin).origin);
}

function assertAllowedUrl(url: URL, allowedOrigins: string[]) {
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new AppError(
			400,
			"SERVER_FETCH_URL_INVALID",
			"服务器拉取 URL 仅允许 http 或 https。",
		);
	}
	if (url.username || url.password) {
		throw new AppError(
			400,
			"SERVER_FETCH_URL_INVALID",
			"服务器拉取 URL 不能包含用户名或密码。",
		);
	}
	if (!allowedOrigins.includes(url.origin)) {
		throw new AppError(
			403,
			"SERVER_FETCH_ORIGIN_NOT_ALLOWED",
			"服务器拉取 URL 不属于站点允许的 Origin。",
			{ origin: url.origin },
		);
	}
}

function ipv4ToNumber(address: string): number | null {
	const parts = address.split(".");
	if (parts.length !== 4) {
		return null;
	}
	let result = 0;
	for (const part of parts) {
		if (!/^\d+$/.test(part)) {
			return null;
		}
		const value = Number(part);
		if (!Number.isInteger(value) || value < 0 || value > 255) {
			return null;
		}
		result = (result << 8) + value;
	}
	return result >>> 0;
}

function isIpv4InRange(address: string, base: string, prefixLength: number) {
	const value = ipv4ToNumber(address);
	const baseValue = ipv4ToNumber(base);
	if (value === null || baseValue === null) {
		return false;
	}
	const mask =
		prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
	return (value & mask) === (baseValue & mask);
}

function isDeniedIpv4(address: string): boolean {
	return [
		["0.0.0.0", 8],
		["10.0.0.0", 8],
		["100.64.0.0", 10],
		["127.0.0.0", 8],
		["169.254.0.0", 16],
		["172.16.0.0", 12],
		["192.168.0.0", 16],
		["224.0.0.0", 4],
		["240.0.0.0", 4],
	].some(([base, prefixLength]) =>
		isIpv4InRange(address, base as string, prefixLength as number),
	);
}

function mappedIpv4FromIpv6(address: string): string | null {
	const normalized = address.toLowerCase();
	const dottedPrefix = "::ffff:";
	if (normalized.startsWith(dottedPrefix)) {
		const dotted = normalized.slice(dottedPrefix.length);
		if (ipv4ToNumber(dotted) !== null) {
			return dotted;
		}
	}
	const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
	if (!match) {
		return null;
	}
	const high = Number.parseInt(match[1] ?? "", 16);
	const low = Number.parseInt(match[2] ?? "", 16);
	if (
		!Number.isInteger(high) ||
		!Number.isInteger(low) ||
		high < 0 ||
		high > 0xffff ||
		low < 0 ||
		low > 0xffff
	) {
		return null;
	}
	return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join(
		".",
	);
}

function isDeniedIpv6(address: string): boolean {
	const normalized = address.toLowerCase();
	if (normalized === "::" || normalized === "::1") {
		return true;
	}
	const mappedIpv4 = mappedIpv4FromIpv6(normalized);
	if (mappedIpv4) {
		return isDeniedIpv4(mappedIpv4);
	}
	const firstGroup = normalized.split(":")[0] ?? "";
	const firstValue = Number.parseInt(firstGroup, 16);
	if (!Number.isFinite(firstValue)) {
		return false;
	}
	return (
		(firstValue & 0xfe00) === 0xfc00 ||
		(firstValue & 0xffc0) === 0xfe80 ||
		(firstValue & 0xff00) === 0xff00
	);
}

function isDeniedAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) {
		return isDeniedIpv4(address);
	}
	if (family === 6) {
		return isDeniedIpv6(address);
	}
	return true;
}

async function resolveHost(
	hostname: string,
	lookupHost: NonNullable<ServerSafeFetchOptions["lookupHost"]>,
) {
	try {
		return await lookupHost(hostname);
	} catch (error) {
		throw new AppError(502, "SERVER_FETCH_FAILED", "服务器拉取目标解析失败。", {
			hostname,
			cause: error instanceof Error ? error.message : String(error),
		});
	}
}

async function assertPublicDestination(
	url: URL,
	lookupHost: NonNullable<ServerSafeFetchOptions["lookupHost"]>,
) {
	const addresses = await resolveHost(url.hostname, lookupHost);
	if (
		addresses.length === 0 ||
		addresses.some((item) => isDeniedAddress(item.address))
	) {
		throw new AppError(
			403,
			"SERVER_FETCH_DESTINATION_DENIED",
			"服务器拉取目标地址不允许访问。",
			{ hostname: url.hostname },
		);
	}
}

function redirectLocation(response: Response): string | null {
	if (response.status < 300 || response.status >= 400) {
		return null;
	}
	return response.headers.get("location");
}

async function fetchWithFailureWrap(
	fetchImpl: typeof fetch,
	url: string,
	signal: AbortSignal,
) {
	try {
		return await fetchImpl(url, { redirect: "manual", signal });
	} catch (error) {
		throw new AppError(502, "SERVER_FETCH_FAILED", "服务器拉取失败。", {
			cause: error instanceof Error ? error.message : String(error),
		});
	}
}

export async function safeFetchText(
	url: string,
	options: ServerSafeFetchOptions,
): Promise<ServerSafeFetchTextResult> {
	const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	const fetchImpl = options.fetchImpl ?? fetch;
	const lookupHost =
		options.lookupHost ??
		((hostname: string) =>
			dnsLookup(hostname, { all: true }) as Promise<
				Array<{ address: string; family: 4 | 6 }>
			>);
	let currentUrl = parseFetchUrl(url);

	for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
		assertAllowedUrl(currentUrl, allowedOrigins);
		await assertPublicDestination(currentUrl, lookupHost);

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetchWithFailureWrap(
				fetchImpl,
				currentUrl.toString(),
				controller.signal,
			);
			const location = redirectLocation(response);
			if (location) {
				if (redirects === maxRedirects) {
					throw new AppError(
						508,
						"SERVER_FETCH_TOO_MANY_REDIRECTS",
						"服务器拉取重定向次数过多。",
					);
				}
				const nextUrl = parseFetchUrl(new URL(location, currentUrl).toString());
				try {
					assertAllowedUrl(nextUrl, allowedOrigins);
				} catch (error) {
					if (error instanceof AppError) {
						throw new AppError(
							403,
							"SERVER_FETCH_REDIRECT_DENIED",
							"服务器拉取重定向目标不允许访问。",
							{ url: nextUrl.toString(), causeCode: error.code },
						);
					}
					throw error;
				}
				currentUrl = nextUrl;
				continue;
			}

			const text = await response.text();
			if (new TextEncoder().encode(text).byteLength > maxBytes) {
				throw new AppError(
					413,
					"SERVER_FETCH_TOO_LARGE",
					"服务器拉取内容超过大小限制。",
				);
			}
			return { status: response.status, url: currentUrl.toString(), text };
		} finally {
			clearTimeout(timeout);
		}
	}

	throw new AppError(
		508,
		"SERVER_FETCH_TOO_MANY_REDIRECTS",
		"服务器拉取重定向次数过多。",
	);
}
