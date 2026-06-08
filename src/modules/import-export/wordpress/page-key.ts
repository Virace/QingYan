export type PageKeyStrategy =
	| "path_without_leading_slash"
	| "path_with_leading_slash"
	| "page_url_path"
	| "custom_template"
	| "explicit_only";

export interface ExplicitMappingItem {
	wpPostId?: string;
	sourceRelativePath?: string;
	decision: "map" | "skip";
	reason?: string;
	target?: {
		pageKey: string;
		pageUrl?: string;
	};
}

export interface ExplicitMapping {
	siteKey?: string;
	sourceBasePath?: string;
	items: ExplicitMappingItem[];
}

export interface PageKeyInput {
	wpPostId: string;
	sourcePath: string;
	sourceRelativePath: string;
	postType: "post" | "page";
	strategy: PageKeyStrategy;
	postPathTemplate?: string;
	pagePathTemplate?: string;
	mapping?: ExplicitMapping;
}

export interface PageKeyResolution {
	decision: "map" | "skip" | "needs_user_mapping";
	pageKey?: string;
	pageUrl?: string;
	confidence: number;
	source: "explicit_mapping" | "strategy" | "none";
	reason?: string;
}

function trimLeadingSlash(value: string): string {
	return value.replace(/^\/+/, "");
}

function ensureLeadingSlash(value: string): string {
	return value.startsWith("/") ? value : `/${value}`;
}

function renderTemplate(template: string, input: PageKeyInput): string {
	return template
		.replaceAll("%sourceRelativePath%", input.sourceRelativePath)
		.replaceAll("%sourcePath%", input.sourcePath)
		.replaceAll("%wpPostId%", input.wpPostId);
}

function findExplicitMapping(
	input: PageKeyInput,
): ExplicitMappingItem | undefined {
	const items = input.mapping?.items ?? [];
	return (
		items.find((item) => item.wpPostId === input.wpPostId) ??
		items.find((item) => item.sourceRelativePath === input.sourceRelativePath)
	);
}

export function resolvePageKey(input: PageKeyInput): PageKeyResolution {
	const explicit = findExplicitMapping(input);
	if (explicit) {
		if (explicit.decision === "skip") {
			return {
				decision: "skip",
				confidence: 100,
				source: "explicit_mapping",
				reason: explicit.reason,
			};
		}
		if (explicit.target) {
			return {
				decision: "map",
				pageKey: explicit.target.pageKey,
				pageUrl: explicit.target.pageUrl,
				confidence: 100,
				source: "explicit_mapping",
			};
		}
	}

	if (input.strategy === "explicit_only") {
		return {
			decision: "needs_user_mapping",
			confidence: 0,
			source: "none",
			reason: "explicit_mapping_required",
		};
	}

	const template =
		input.postType === "page" ? input.pagePathTemplate : input.postPathTemplate;
	const targetPath = template
		? renderTemplate(template, input)
		: input.sourceRelativePath;

	switch (input.strategy) {
		case "path_without_leading_slash":
			return {
				decision: "map",
				pageKey: trimLeadingSlash(targetPath),
				pageUrl: ensureLeadingSlash(targetPath),
				confidence: 60,
				source: "strategy",
			};
		case "path_with_leading_slash":
		case "page_url_path":
			return {
				decision: "map",
				pageKey: ensureLeadingSlash(targetPath),
				pageUrl: ensureLeadingSlash(targetPath),
				confidence: 60,
				source: "strategy",
			};
		case "custom_template":
			return {
				decision: "map",
				pageKey: targetPath,
				pageUrl: ensureLeadingSlash(targetPath),
				confidence: 60,
				source: "strategy",
			};
	}
}
