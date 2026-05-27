import {
	buildImportPlanSummary,
	type ImportPlan,
	type ImportPlanComment,
	type ImportPlanItem,
} from "../import-plan";
import type { CommentStatus } from "../../comments/moderation-types";
import type { MigrationReport, MigrationReportItem } from "../report";

export interface ConvertReportInput {
	report: MigrationReport;
	authorDecisions?: Record<string, "verified" | "visitor">;
	maxDepth?: number;
	now?: Date;
}

function isResolved(item: MigrationReportItem): boolean {
	return item.state === "ready" || item.state === "skipped";
}

function sortParentBeforeChild(
	comments: ImportPlanComment[],
): ImportPlanComment[] {
	return [...comments].sort((left, right) => {
		if (left.depth !== right.depth) {
			return left.depth - right.depth;
		}
		return left.source.oldCommentId.localeCompare(right.source.oldCommentId);
	});
}

function isImportableComment(
	comment: MigrationReportItem["comments"][number],
): comment is MigrationReportItem["comments"][number] & {
	status: CommentStatus;
} {
	return comment.status !== "skipped";
}

function resolveAuthorIdentity(
	comment: MigrationReportItem["comments"][number],
	authorDecisions: Record<string, "verified" | "visitor"> | undefined,
): "verified" | "visitor" {
	switch (comment.authorMatch?.kind) {
		case "staff_strong":
			return "verified";
		case "staff_email_candidate": {
			const decision = authorDecisions?.[comment.oldCommentId];
			if (!decision) {
				throw new Error(
					`Unresolved WordPress author candidates: ${comment.oldCommentId}`,
				);
			}
			return decision;
		}
		case "registered_unknown":
		case "visitor":
		case undefined:
			return "visitor";
	}
}

function convertItem(
	report: MigrationReport,
	item: MigrationReportItem,
	maxDepth: number,
	authorDecisions: ConvertReportInput["authorDecisions"],
): ImportPlanItem | null {
	if (item.state === "skipped") {
		return null;
	}
	if (!item.target?.pageKey) {
		throw new Error(`Missing target for resolved item ${item.wpPostId}`);
	}

	const comments = item.comments
		.filter(isImportableComment)
		.map<ImportPlanComment>((comment) => ({
			source: {
				wpPostId: item.wpPostId,
				sourceRelativePath: item.sourceRelativePath,
				oldCommentId: comment.oldCommentId,
				oldParentCommentId: comment.oldParentCommentId,
			},
			status: comment.status,
			authorName: comment.authorName,
			authorEmail: comment.authorEmail,
			authorUrl: comment.authorUrl,
			authorIp: comment.authorIp,
			userAgent: comment.userAgent,
			authorIdentity: resolveAuthorIdentity(comment, authorDecisions),
			content: comment.content,
			createdAt: comment.createdAt,
			parentOldCommentId: comment.oldParentCommentId,
			depth: comment.depth,
		}));

	const warnings = [...item.warnings];
	if (item.commentSummary.maxDepth > maxDepth) {
		warnings.push(`comment_depth_exceeds_max:${item.commentSummary.maxDepth}`);
	}

	return {
		siteKey: report.siteKey,
		pageKey: item.target.pageKey,
		pageUrl: item.target.pageUrl,
		pageTitle: item.title,
		source: {
			wpPostId: item.wpPostId,
			sourceRelativePath: item.sourceRelativePath,
			sourcePath: item.sourcePath,
		},
		comments: sortParentBeforeChild(comments),
		warnings,
	};
}

export function convertReportToImportPlan(
	input: ConvertReportInput,
): ImportPlan {
	const unresolved = input.report.items.filter((item) => !isResolved(item));
	if (unresolved.length > 0) {
		throw new Error(
			`Cannot convert unresolved migration report: ${unresolved
				.map((item) => `${item.wpPostId}:${item.state}`)
				.join(", ")}`,
		);
	}

	const maxDepth = input.maxDepth ?? 3;
	const items = input.report.items
		.map((item) =>
			convertItem(input.report, item, maxDepth, input.authorDecisions),
		)
		.filter((item): item is ImportPlanItem => item !== null);

	return {
		siteKey: input.report.siteKey,
		source: {
			...input.report.source,
		},
		sourceBasePath: input.report.sourceBasePath,
		createdAt: (input.now ?? new Date()).toISOString(),
		items,
		summary: buildImportPlanSummary(items),
	};
}
