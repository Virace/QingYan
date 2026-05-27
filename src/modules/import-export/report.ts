import type { CommentStatus } from "../comments/moderation-types";
import type { MigrationItemState } from "./import-plan";

export interface MigrationReportSource {
	type: "wordpress-wxr";
	fileName: string;
}

export interface MigrationReportSummary {
	totalItems: number;
	ready: number;
	needsUserMapping: number;
	ambiguous: number;
	unverified: number;
	conflict: number;
	skipped: number;
	totalComments: number;
	maxCommentDepth: number;
	warningCount: number;
}

export type MigrationReportAuthorMatchKind =
	| "staff_strong"
	| "staff_email_candidate"
	| "registered_unknown"
	| "visitor";

export interface MigrationReportAuthorMatch {
	kind: MigrationReportAuthorMatchKind;
	wpAuthorId?: string;
	email?: string;
}

export interface MigrationReportAuthorSummary {
	totalAuthors: number;
	staffStrong: number;
	staffEmailCandidate: number;
	registeredUnknown: number;
	visitor: number;
}

export interface MigrationReportHtmlContentSummary {
	htmlLikeComments: number;
	examples: Array<{
		oldCommentId: string;
		snippet: string;
	}>;
}

export interface MigrationReportComment {
	oldCommentId: string;
	oldParentCommentId: string | null;
	status: CommentStatus | "skipped";
	skipReason?: string;
	authorName: string;
	authorEmail?: string;
	authorUrl?: string;
	authorIp?: string;
	userAgent?: string;
	content: string;
	authorMatch?: MigrationReportAuthorMatch;
	createdAt?: string;
	depth: number;
	warnings: string[];
}

export interface MigrationReportItemTarget {
	pageKey: string;
	pageUrl?: string;
	confidence: number;
	source: "explicit_mapping" | "strategy" | "metadata" | "none";
}

export interface MigrationReportItem {
	state: MigrationItemState;
	wpPostId: string;
	postType: "post" | "page";
	title: string;
	link: string;
	sourcePath: string;
	sourceRelativePath: string;
	target?: MigrationReportItemTarget;
	evidence: {
		status: "verified" | "unverified" | "ambiguous" | "missing" | "skipped";
		distPath?: string;
		title?: string;
		h1?: string;
		canonical?: string;
		ogTitle?: string;
		confidence: number;
		reasons: string[];
	};
	comments: MigrationReportComment[];
	commentSummary: {
		total: number;
		migratable: number;
		skipped: number;
		maxDepth: number;
	};
	warnings: string[];
}

export interface MigrationReport {
	siteKey: string;
	source: MigrationReportSource;
	sourceBasePath: string;
	createdAt: string;
	wxr: {
		title?: string;
		link?: string;
		baseSiteUrl?: string;
		baseBlogUrl?: string;
		version?: string;
	};
	authorSummary?: MigrationReportAuthorSummary;
	htmlContentSummary?: MigrationReportHtmlContentSummary;
	sourcePathExamples: Array<{
		link: string;
		sourcePath: string;
		sourceRelativePath: string;
		warnings: string[];
	}>;
	items: MigrationReportItem[];
	summary: MigrationReportSummary;
}

const initialSummary: MigrationReportSummary = {
	totalItems: 0,
	ready: 0,
	needsUserMapping: 0,
	ambiguous: 0,
	unverified: 0,
	conflict: 0,
	skipped: 0,
	totalComments: 0,
	maxCommentDepth: 0,
	warningCount: 0,
};

export function buildMigrationReportSummary(
	items: MigrationReportItem[],
): MigrationReportSummary {
	const summary = { ...initialSummary };

	for (const item of items) {
		summary.totalItems += 1;
		summary.totalComments += item.commentSummary.migratable;
		summary.maxCommentDepth = Math.max(
			summary.maxCommentDepth,
			item.commentSummary.maxDepth,
		);
		summary.warningCount += item.warnings.length;
		summary.warningCount += item.comments.reduce(
			(total, comment) => total + comment.warnings.length,
			0,
		);

		switch (item.state) {
			case "ready":
				summary.ready += 1;
				break;
			case "needs_user_mapping":
				summary.needsUserMapping += 1;
				break;
			case "ambiguous":
				summary.ambiguous += 1;
				break;
			case "unverified":
				summary.unverified += 1;
				break;
			case "conflict":
				summary.conflict += 1;
				break;
			case "skipped":
				summary.skipped += 1;
				break;
		}
	}

	return summary;
}

function tableRow(values: Array<string | number>): string {
	return `| ${values.map((value) => String(value).replaceAll("|", "\\|")).join(" | ")} |`;
}

export function renderMigrationReportMarkdown(report: MigrationReport): string {
	const lines = [
		"# WordPress Comment Migration Report",
		"",
		"## Inputs",
		"",
		tableRow(["Field", "Value"]),
		tableRow(["---", "---"]),
		tableRow(["siteKey", report.siteKey]),
		tableRow(["source", report.source.fileName]),
		tableRow(["sourceBasePath", report.sourceBasePath]),
		tableRow(["createdAt", report.createdAt]),
		"",
		"## WXR Metadata",
		"",
		tableRow(["Field", "Value"]),
		tableRow(["---", "---"]),
		tableRow(["title", report.wxr.title ?? ""]),
		tableRow(["link", report.wxr.link ?? ""]),
		tableRow(["baseSiteUrl", report.wxr.baseSiteUrl ?? ""]),
		tableRow(["baseBlogUrl", report.wxr.baseBlogUrl ?? ""]),
		tableRow(["version", report.wxr.version ?? ""]),
		"",
		"## Source Path Examples",
		"",
		tableRow(["Link", "Source Path", "Relative Path", "Warnings"]),
		tableRow(["---", "---", "---", "---"]),
		...report.sourcePathExamples.map((example) =>
			tableRow([
				example.link,
				example.sourcePath,
				example.sourceRelativePath,
				example.warnings.join("; "),
			]),
		),
		"",
		"## Summary",
		"",
		tableRow(["State", "Count"]),
		tableRow(["---", "---"]),
		tableRow(["ready", report.summary.ready]),
		tableRow(["needs_user_mapping", report.summary.needsUserMapping]),
		tableRow(["ambiguous", report.summary.ambiguous]),
		tableRow(["unverified", report.summary.unverified]),
		tableRow(["conflict", report.summary.conflict]),
		tableRow(["skipped", report.summary.skipped]),
		tableRow(["totalComments", report.summary.totalComments]),
		tableRow(["maxCommentDepth", report.summary.maxCommentDepth]),
		tableRow(["warningCount", report.summary.warningCount]),
		"",
	];

	const unresolved = report.items.filter((item) =>
		["needs_user_mapping", "ambiguous", "unverified"].includes(item.state),
	);
	lines.push("## Unresolved Rows", "");
	lines.push(tableRow(["State", "wpPostId", "Title", "Source", "Candidate"]));
	lines.push(tableRow(["---", "---", "---", "---", "---"]));
	for (const item of unresolved) {
		lines.push(
			tableRow([
				item.state,
				item.wpPostId,
				item.title,
				item.sourceRelativePath,
				item.target?.pageKey ?? "",
			]),
		);
	}

	const conflicts = report.items.filter((item) => item.state === "conflict");
	lines.push("", "## Conflict Rows", "");
	lines.push(tableRow(["wpPostId", "Title", "Source", "Target"]));
	lines.push(tableRow(["---", "---", "---", "---"]));
	for (const item of conflicts) {
		lines.push(
			tableRow([
				item.wpPostId,
				item.title,
				item.sourceRelativePath,
				item.target?.pageKey ?? "",
			]),
		);
	}

	const depthWarnings = report.items.filter(
		(item) => item.commentSummary.maxDepth > 1 || item.warnings.length > 0,
	);
	lines.push("", "## Nested Comment Warnings", "");
	lines.push(tableRow(["wpPostId", "Title", "Max Depth", "Warnings"]));
	lines.push(tableRow(["---", "---", "---", "---"]));
	for (const item of depthWarnings) {
		lines.push(
			tableRow([
				item.wpPostId,
				item.title,
				item.commentSummary.maxDepth,
				item.warnings.join("; "),
			]),
		);
	}

	return `${lines.join("\n")}\n`;
}

export function buildSuggestedMapping(report: MigrationReport) {
	return {
		siteKey: report.siteKey,
		sourceBasePath: report.sourceBasePath,
		items: report.items
			.filter((item) =>
				["needs_user_mapping", "ambiguous", "unverified", "conflict"].includes(
					item.state,
				),
			)
			.map((item) => ({
				wpPostId: item.wpPostId,
				sourceRelativePath: item.sourceRelativePath,
				state: item.state,
				title: item.title,
				decision: "map",
				target: {
					pageKey: item.target?.pageKey ?? "",
					pageUrl: item.target?.pageUrl ?? "",
				},
				reason: item.warnings.join("; "),
			})),
	};
}
