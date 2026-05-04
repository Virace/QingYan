export type MigrationItemState =
	| "ready"
	| "needs_user_mapping"
	| "ambiguous"
	| "unverified"
	| "conflict"
	| "skipped";

export interface ImportPlanSource {
	type: "wordpress-wxr";
	fileName: string;
	reportHash?: string;
}

export interface ImportPlanCommentSource {
	wpPostId: string;
	sourceRelativePath: string;
	oldCommentId: string;
	oldParentCommentId: string | null;
}

export interface ImportPlanComment {
	source: ImportPlanCommentSource;
	status: "approved" | "pending";
	authorName: string;
	authorEmail?: string;
	authorUrl?: string;
	authorIp?: string;
	userAgent?: string;
	content: string;
	createdAt?: string;
	parentOldCommentId: string | null;
	depth: number;
}

export interface ImportPlanItem {
	siteKey: string;
	pageKey: string;
	pageUrl?: string;
	pageTitle?: string;
	source: {
		wpPostId: string;
		sourceRelativePath: string;
		sourcePath: string;
	};
	comments: ImportPlanComment[];
	warnings: string[];
}

export interface ImportPlanSummary {
	itemCount: number;
	commentCount: number;
	maxCommentDepth: number;
	warningCount: number;
}

export interface ImportPlan {
	siteKey: string;
	source: ImportPlanSource;
	sourceBasePath: string;
	createdAt: string;
	items: ImportPlanItem[];
	summary: ImportPlanSummary;
}

export function buildImportPlanSummary(
	items: ImportPlanItem[],
): ImportPlanSummary {
	let commentCount = 0;
	let maxCommentDepth = 0;
	let warningCount = 0;

	for (const item of items) {
		commentCount += item.comments.length;
		warningCount += item.warnings.length;
		for (const comment of item.comments) {
			maxCommentDepth = Math.max(maxCommentDepth, comment.depth);
		}
	}

	return {
		itemCount: items.length,
		commentCount,
		maxCommentDepth,
		warningCount,
	};
}
