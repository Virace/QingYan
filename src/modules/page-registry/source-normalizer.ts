import type { PageSourceEntry } from "./source-parser";
import { deriveCanonicalPageKeyFromPathname } from "../shared/canonical-page-key";

export interface NormalizePageSourceEntryInput {
	entry: PageSourceEntry;
	allowedOrigins: string[];
}

export interface ResolvedPageSourceEntry {
	pageKey: string;
	pageUrl: string;
	title?: string;
	warnings: string[];
}

export type PageSourceEntryRejectionReason =
	| "invalid_url"
	| "cross_origin"
	| "source_path"
	| "api_path"
	| "asset_path";

const ASSET_EXTENSIONS = new Set([
	".avif",
	".css",
	".gif",
	".ico",
	".jpeg",
	".jpg",
	".js",
	".json",
	".map",
	".png",
	".svg",
	".webp",
	".woff",
	".woff2",
]);

function normalizeOrigin(value: string): string | null {
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return null;
		}
		return parsed.origin;
	} catch {
		return null;
	}
}

function hasAllowedOrigin(url: URL, allowedOrigins: string[]): boolean {
	return allowedOrigins
		.map((origin) => normalizeOrigin(origin))
		.some((origin) => origin === url.origin);
}

function hasAssetExtension(pathname: string): boolean {
	const lastSegment = pathname.split("/").at(-1) ?? "";
	const dotIndex = lastSegment.lastIndexOf(".");
	if (dotIndex === -1) {
		return false;
	}
	return ASSET_EXTENSIONS.has(lastSegment.slice(dotIndex).toLowerCase());
}

export function getPageSourceEntryRejectionReason(
	input: NormalizePageSourceEntryInput,
): PageSourceEntryRejectionReason | null {
	let parsed: URL;
	try {
		parsed = new URL(input.entry.url);
	} catch {
		return "invalid_url";
	}

	if (
		(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
		!hasAllowedOrigin(parsed, input.allowedOrigins)
	) {
		return "cross_origin";
	}

	const pathname = parsed.pathname;
	const lowerPathname = pathname.toLowerCase();
	if (
		lowerPathname === "/sitemap.xml" ||
		lowerPathname.endsWith("-sitemap.xml") ||
		lowerPathname === "/feed.xml" ||
		lowerPathname.endsWith("/feed.xml") ||
		lowerPathname.endsWith(".rss") ||
		lowerPathname.endsWith(".atom")
	) {
		return "source_path";
	}

	if (lowerPathname === "/api" || lowerPathname.startsWith("/api/")) {
		return "api_path";
	}

	if (
		lowerPathname.startsWith("/assets/") ||
		lowerPathname.startsWith("/_astro/") ||
		hasAssetExtension(lowerPathname)
	) {
		return "asset_path";
	}

	return null;
}

export function normalizePageSourceEntry(
	input: NormalizePageSourceEntryInput,
): ResolvedPageSourceEntry | null {
	if (getPageSourceEntryRejectionReason(input)) {
		return null;
	}

	const parsed = new URL(input.entry.url);
	const pageUrl = parsed.pathname || "/";
	const pageKey = deriveCanonicalPageKeyFromPathname(pageUrl);

	return {
		pageKey,
		pageUrl,
		title: input.entry.title,
		warnings: input.entry.warnings,
	};
}
