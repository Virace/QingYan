import path from "node:path";

import {
	buildMigrationReportSummary,
	type MigrationReport,
	type MigrationReportComment,
	type MigrationReportItem,
} from "../report";
import { verifyDistTarget } from "./dist-verifier";
import {
	type ExplicitMapping,
	type PageKeyStrategy,
	resolvePageKey,
} from "./page-key";
import {
	normalizeSourceBasePath,
	normalizeSourcePath,
	type SourcePathResult,
} from "./source-path";
import { parseWxr } from "./wxr-parser";
import type { WxrComment, WxrItem } from "./wxr-types";

export interface AnalyzeWordPressCommentsInput {
	xml: string;
	fileName: string;
	siteKey: string;
	sourceBasePath?: string;
	targetDistRoot?: string;
	pageKeyStrategy?: PageKeyStrategy;
	postPathTemplate?: string;
	pagePathTemplate?: string;
	mapping?: ExplicitMapping;
	now?: Date;
}

interface CommentTreeResult {
	comments: MigrationReportComment[];
	total: number;
	migratable: number;
	skipped: number;
	maxDepth: number;
	warnings: string[];
}

function isOrdinaryComment(comment: WxrComment): boolean {
	return !comment.type || comment.type === "comment";
}

function mapCommentStatus(comment: WxrComment): {
	status: "approved" | "pending" | "skipped";
	skipReason?: string;
} {
	if (comment.approved === "spam" || comment.approved === "trash") {
		return { status: "skipped", skipReason: `status_${comment.approved}` };
	}
	if (!isOrdinaryComment(comment)) {
		return { status: "skipped", skipReason: `type_${comment.type}` };
	}
	if (comment.approved === "1") {
		return { status: "approved" };
	}
	return { status: "pending" };
}

function computeDepth(
	comment: WxrComment,
	byId: Map<string, WxrComment>,
	visiting = new Set<string>(),
): { depth: number; warning?: string } {
	if (!comment.parentId) {
		return { depth: 1 };
	}
	const parent = byId.get(comment.parentId);
	if (!parent) {
		return { depth: 1, warning: `missing_parent:${comment.parentId}` };
	}
	if (visiting.has(comment.commentId)) {
		return { depth: 1, warning: "comment_parent_cycle" };
	}
	visiting.add(comment.commentId);
	const parentDepth = computeDepth(parent, byId, visiting);
	return {
		depth: parentDepth.depth + 1,
		warning: parentDepth.warning,
	};
}

function analyzeComments(comments: WxrComment[]): CommentTreeResult {
	const byId = new Map(comments.map((comment) => [comment.commentId, comment]));
	const reportComments: MigrationReportComment[] = [];
	const warnings = new Set<string>();
	let migratable = 0;
	let skipped = 0;
	let maxDepth = 0;

	for (const comment of comments) {
		const mapped = mapCommentStatus(comment);
		const depthResult = computeDepth(comment, byId);
		const commentWarnings = depthResult.warning ? [depthResult.warning] : [];
		for (const warning of commentWarnings) {
			warnings.add(warning);
		}
		if (mapped.status === "skipped") {
			skipped += 1;
		} else {
			migratable += 1;
			maxDepth = Math.max(maxDepth, depthResult.depth);
		}
		reportComments.push({
			oldCommentId: comment.commentId,
			oldParentCommentId: comment.parentId,
			status: mapped.status,
			skipReason: mapped.skipReason,
			authorName: comment.authorName,
			authorEmail: comment.authorEmail,
			authorUrl: comment.authorUrl,
			authorIp: comment.authorIp,
			userAgent: comment.userAgent,
			content: comment.content,
			createdAt: comment.dateGmt ?? comment.date,
			depth: depthResult.depth,
			warnings: commentWarnings,
		});
	}

	return {
		comments: reportComments.sort((left, right) => left.depth - right.depth),
		total: comments.length,
		migratable,
		skipped,
		maxDepth,
		warnings: [...warnings],
	};
}

function classifyItem(input: {
	sourcePath: SourcePathResult;
	pageKey: ReturnType<typeof resolvePageKey>;
	evidence: ReturnType<typeof verifyDistTarget>;
}): MigrationReportItem["state"] {
	if (!input.sourcePath.valid) {
		return "needs_user_mapping";
	}
	if (input.pageKey.decision === "skip") {
		return "skipped";
	}
	if (
		input.pageKey.decision === "needs_user_mapping" ||
		!input.pageKey.pageKey
	) {
		return "needs_user_mapping";
	}
	switch (input.evidence.status) {
		case "verified":
			return input.evidence.confidence >= 80 ? "ready" : "unverified";
		case "ambiguous":
			return "ambiguous";
		case "missing":
			return "needs_user_mapping";
		case "unverified":
			return "unverified";
		case "skipped":
			return input.pageKey.source === "explicit_mapping"
				? "ready"
				: "unverified";
	}
}

function buildReportItem(
	item: WxrItem,
	sourcePath: SourcePathResult,
	input: AnalyzeWordPressCommentsInput,
	commentTree: CommentTreeResult,
): MigrationReportItem {
	const pageKey = resolvePageKey({
		wpPostId: item.wpPostId,
		postType: item.postType,
		sourcePath: sourcePath.sourcePath,
		sourceRelativePath: sourcePath.sourceRelativePath,
		strategy: input.pageKeyStrategy ?? "path_without_leading_slash",
		postPathTemplate: input.postPathTemplate,
		pagePathTemplate: input.pagePathTemplate,
		mapping: input.mapping,
	});
	const evidence = verifyDistTarget({
		targetDistRoot: input.targetDistRoot,
		targetPath: pageKey.pageUrl ?? pageKey.pageKey,
		sourceTitle: item.title,
		sourcePath: sourcePath.sourcePath,
		sourceRelativePath: sourcePath.sourceRelativePath,
		wpPostId: item.wpPostId,
	});
	const state = classifyItem({ sourcePath, pageKey, evidence });

	return {
		state,
		wpPostId: item.wpPostId,
		postType: item.postType,
		title: item.title,
		link: item.link,
		sourcePath: sourcePath.sourcePath,
		sourceRelativePath: sourcePath.sourceRelativePath,
		target: pageKey.pageKey
			? {
					pageKey: pageKey.pageKey,
					pageUrl: pageKey.pageUrl,
					confidence: Math.max(pageKey.confidence, evidence.confidence),
					source: pageKey.source,
				}
			: undefined,
		evidence,
		comments: commentTree.comments,
		commentSummary: {
			total: commentTree.total,
			migratable: commentTree.migratable,
			skipped: commentTree.skipped,
			maxDepth: commentTree.maxDepth,
		},
		warnings: [...sourcePath.warnings, ...commentTree.warnings],
	};
}

export function analyzeWordPressComments(
	input: AnalyzeWordPressCommentsInput,
): MigrationReport {
	const wxr = parseWxr(input.xml);
	const sourceBasePath = normalizeSourceBasePath(input.sourceBasePath);
	const sourcePathExamples: MigrationReport["sourcePathExamples"] = [];
	const items: MigrationReportItem[] = [];

	for (const item of wxr.items) {
		const sourcePath = normalizeSourcePath(item.link, sourceBasePath);
		if (sourcePathExamples.length < 5) {
			sourcePathExamples.push({
				link: item.link,
				sourcePath: sourcePath.sourcePath,
				sourceRelativePath: sourcePath.sourceRelativePath,
				warnings: sourcePath.warnings,
			});
		}
		const commentTree = analyzeComments(item.comments);
		if (commentTree.migratable === 0) {
			continue;
		}
		items.push(buildReportItem(item, sourcePath, input, commentTree));
	}

	const targetCounts = new Map<string, number>();
	for (const item of items) {
		if (item.target?.pageKey && item.state !== "skipped") {
			targetCounts.set(
				item.target.pageKey,
				(targetCounts.get(item.target.pageKey) ?? 0) + 1,
			);
		}
	}
	for (const item of items) {
		if (
			item.target?.pageKey &&
			item.state !== "skipped" &&
			(targetCounts.get(item.target.pageKey) ?? 0) > 1
		) {
			item.state = "conflict";
			item.warnings.push("duplicate_target_page_key");
		}
	}

	const report = {
		siteKey: input.siteKey,
		source: {
			type: "wordpress-wxr" as const,
			fileName: path.basename(input.fileName),
		},
		sourceBasePath,
		createdAt: (input.now ?? new Date()).toISOString(),
		wxr: wxr.metadata,
		sourcePathExamples,
		items,
		summary: buildMigrationReportSummary(items),
	};

	return report;
}
