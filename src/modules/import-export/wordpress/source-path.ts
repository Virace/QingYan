export interface SourcePathResult {
	sourcePath: string;
	sourceRelativePath: string;
	warnings: string[];
	valid: boolean;
}

function normalizePathSlashes(value: string): string {
	return value.replaceAll("\\", "/").replace(/\/+/g, "/");
}

export function normalizeSourceBasePath(value?: string | null): string {
	const trimmed = value?.trim();
	if (!trimmed || trimmed === "/") {
		return "/";
	}

	const normalized = normalizePathSlashes(trimmed);
	const withLeadingSlash = normalized.startsWith("/")
		? normalized
		: `/${normalized}`;
	return withLeadingSlash.endsWith("/")
		? withLeadingSlash
		: `${withLeadingSlash}/`;
}

export function extractUrlPath(link: string): string | null {
	try {
		const parsed = new URL(link);
		return parsed.pathname || "/";
	} catch {
		return null;
	}
}

export function normalizeSourcePath(
	link: string,
	sourceBasePath?: string | null,
): SourcePathResult {
	const warnings: string[] = [];
	const sourcePath = extractUrlPath(link);
	if (!sourcePath) {
		return {
			sourcePath: "",
			sourceRelativePath: "",
			warnings: ["invalid_source_url"],
			valid: false,
		};
	}

	const basePath = normalizeSourceBasePath(sourceBasePath);
	const normalizedSourcePath = normalizePathSlashes(sourcePath);
	let sourceRelativePath = normalizedSourcePath.startsWith("/")
		? normalizedSourcePath.slice(1)
		: normalizedSourcePath;

	if (basePath !== "/") {
		const sourceWithSlash = normalizedSourcePath.endsWith("/")
			? normalizedSourcePath
			: `${normalizedSourcePath}/`;
		if (
			normalizedSourcePath === basePath.slice(0, -1) ||
			sourceWithSlash.startsWith(basePath)
		) {
			sourceRelativePath = normalizedSourcePath.slice(basePath.length);
		} else {
			warnings.push("source_base_path_not_matched");
		}
	}

	return {
		sourcePath: normalizedSourcePath,
		sourceRelativePath,
		warnings,
		valid: true,
	};
}
