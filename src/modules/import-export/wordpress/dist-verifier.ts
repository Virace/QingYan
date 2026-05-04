import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface DistEvidence {
	status: "verified" | "unverified" | "ambiguous" | "missing" | "skipped";
	distPath?: string;
	title?: string;
	h1?: string;
	canonical?: string;
	ogTitle?: string;
	meta?: {
		wpPostId?: string;
		sourcePath?: string;
		sourceRelativePath?: string;
	};
	confidence: number;
	reasons: string[];
}

export interface VerifyDistInput {
	targetDistRoot?: string;
	targetPath?: string;
	sourceTitle: string;
	sourcePath: string;
	sourceRelativePath: string;
	wpPostId: string;
}

function cleanTargetPath(value: string): string {
	return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function normalizeComparablePath(value: string): string {
	const cleaned = cleanTargetPath(value);
	if (!cleaned) {
		return "";
	}
	return cleaned.replace(/\/+$/u, "");
}

function existingHtmlFiles(candidates: string[]): string[] {
	return candidates.filter((candidate) => {
		if (!existsSync(candidate)) {
			return false;
		}
		return statSync(candidate).isFile();
	});
}

function pathMatchesSource(input: VerifyDistInput): boolean {
	const target = normalizeComparablePath(input.targetPath ?? "");
	const sourceRelative = normalizeComparablePath(input.sourceRelativePath);
	const sourcePath = normalizeComparablePath(input.sourcePath);
	return target !== "" && (target === sourceRelative || target === sourcePath);
}

export function getDistHtmlCandidates(
	targetDistRoot: string,
	targetPath: string,
): string[] {
	const normalized = cleanTargetPath(targetPath);
	if (!normalized || normalized === "/") {
		return [path.join(targetDistRoot, "index.html")];
	}

	const candidates = new Set<string>();
	if (normalized.endsWith(".html")) {
		candidates.add(path.join(targetDistRoot, normalized));
	} else if (normalized.endsWith("/")) {
		candidates.add(path.join(targetDistRoot, normalized, "index.html"));
	} else {
		candidates.add(path.join(targetDistRoot, normalized));
		candidates.add(path.join(targetDistRoot, `${normalized}.html`));
		candidates.add(path.join(targetDistRoot, normalized, "index.html"));
	}

	return [...candidates];
}

function decodeHtml(value: string): string {
	return value
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'");
}

export function normalizeTitle(value?: string): string {
	return decodeHtml(value ?? "")
		.replace(/\s+/g, " ")
		.replace(/[|｜-].*$/u, "")
		.trim()
		.toLowerCase();
}

function extractFirstMatch(html: string, pattern: RegExp): string | undefined {
	const match = pattern.exec(html);
	return match?.[1] ? decodeHtml(match[1].trim()) : undefined;
}

function extractMetaContent(html: string, name: string): string | undefined {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return extractFirstMatch(
		html,
		new RegExp(
			`<meta\\b(?=[^>]*(?:name|property)=["']${escaped}["'])[^>]*content=["']([^"']*)["'][^>]*>`,
			"i",
		),
	);
}

export function extractHtmlEvidence(
	html: string,
): Omit<DistEvidence, "status" | "confidence" | "reasons" | "distPath"> {
	return {
		title: extractFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
		h1: extractFirstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)?.replace(
			/<[^>]+>/g,
			"",
		),
		canonical: extractFirstMatch(
			html,
			/<link\b(?=[^>]*rel=["']canonical["'])[^>]*href=["']([^"']*)["'][^>]*>/i,
		),
		ogTitle: extractMetaContent(html, "og:title"),
		meta: {
			wpPostId: extractMetaContent(html, "qingyan:wp-post-id"),
			sourcePath: extractMetaContent(html, "qingyan:source-path"),
			sourceRelativePath: extractMetaContent(
				html,
				"qingyan:source-relative-path",
			),
		},
	};
}

function pathMatchesCanonical(
	canonical: string | undefined,
	targetPath: string,
) {
	if (!canonical) {
		return false;
	}
	try {
		const canonicalPath = new URL(canonical, "https://qingyan.local").pathname;
		const target = `/${cleanTargetPath(targetPath)}`;
		return (
			canonicalPath === target ||
			canonicalPath === `${target}/` ||
			canonicalPath === target.replace(/\/index\.html$/u, "/")
		);
	} catch {
		return false;
	}
}

export function verifyDistTarget(input: VerifyDistInput): DistEvidence {
	if (!input.targetDistRoot || !input.targetPath) {
		return {
			status: "skipped",
			confidence: 0,
			reasons: ["target_dist_root_not_configured"],
		};
	}

	const existing = existingHtmlFiles(
		getDistHtmlCandidates(input.targetDistRoot, input.targetPath),
	);
	if (existing.length === 0) {
		return {
			status: "missing",
			confidence: 0,
			reasons: ["dist_file_missing"],
		};
	}
	if (existing.length > 1) {
		return {
			status: "ambiguous",
			confidence: 40,
			reasons: ["multiple_dist_candidates"],
		};
	}

	const distPath = existing[0];
	const html = readFileSync(distPath, "utf-8");
	const extracted = extractHtmlEvidence(html);
	const reasons: string[] = ["dist_file_exists"];
	const sourceTitle = normalizeTitle(input.sourceTitle);
	const titleMatches = [extracted.title, extracted.h1, extracted.ogTitle].some(
		(title) => normalizeTitle(title) === sourceTitle && sourceTitle,
	);

	if (extracted.meta?.wpPostId === input.wpPostId) {
		return {
			...extracted,
			status: "verified",
			distPath,
			confidence: 100,
			reasons: [...reasons, "wp_post_id_meta_match"],
		};
	}
	if (extracted.meta?.sourceRelativePath === input.sourceRelativePath) {
		return {
			...extracted,
			status: "verified",
			distPath,
			confidence: 100,
			reasons: [...reasons, "source_relative_path_meta_match"],
		};
	}

	const canonicalMatches = pathMatchesCanonical(
		extracted.canonical,
		input.targetPath,
	);
	if (canonicalMatches && titleMatches) {
		return {
			...extracted,
			status: "verified",
			distPath,
			confidence: 90,
			reasons: [...reasons, "canonical_path_match", "title_match"],
		};
	}
	if (pathMatchesSource(input) && titleMatches) {
		return {
			...extracted,
			status: "verified",
			distPath,
			confidence: 85,
			reasons: [...reasons, "source_path_match", "title_match"],
		};
	}
	if (titleMatches) {
		return {
			...extracted,
			status: "unverified",
			distPath,
			confidence: 70,
			reasons: [...reasons, "title_match"],
		};
	}

	return {
		...extracted,
		status: "unverified",
		distPath,
		confidence: 50,
		reasons: [...reasons, "title_mismatch"],
	};
}
