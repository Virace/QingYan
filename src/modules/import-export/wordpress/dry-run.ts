import type { ImportPlan, ImportPlanComment } from "../import-plan";

export type ExistingImportStrategy = "fail_on_existing" | "skip_existing";

export interface WordPressDryRunInput {
	plan: ImportPlan;
	existingPageKeys: Set<string>;
	existingSourceKeys: Set<string>;
	existingStrategy: ExistingImportStrategy;
	maxDepth?: number;
}

export interface WordPressDryRunResult {
	summary: {
		willCreatePageThreads: number;
		willReusePageThreads: number;
		willCreateComments: number;
		willSkipExistingComments: number;
		conflicts: number;
		warnings: number;
	};
	items: Array<{
		type: "page_thread" | "comment";
		status: "create" | "reuse" | "skip" | "conflict" | "warning";
		sourceKey?: string;
		pageKey?: string;
		message: string;
	}>;
}

export function buildWordPressCommentSourceKey(comment: ImportPlanComment) {
	return `wordpress:post:${comment.source.wpPostId}:comment:${comment.source.oldCommentId}`;
}

function uniqueValues(values: string[]) {
	return [...new Set(values)];
}

export function dryRunWordPressImport(
	input: WordPressDryRunInput,
): WordPressDryRunResult {
	let willCreateComments = 0;
	let willSkipExistingComments = 0;
	let conflicts = 0;
	let warnings = 0;
	const items: WordPressDryRunResult["items"] = [];
	const pageKeys = uniqueValues(input.plan.items.map((item) => item.pageKey));

	for (const pageKey of pageKeys) {
		const exists = input.existingPageKeys.has(pageKey);
		items.push({
			type: "page_thread",
			status: exists ? "reuse" : "create",
			pageKey,
			message: exists
				? "page thread already exists"
				: "page thread will be created",
		});
	}

	for (const item of input.plan.items) {
		const oldCommentIds = new Set(
			item.comments.map((comment) => comment.source.oldCommentId),
		);
		for (const comment of item.comments) {
			const sourceKey = buildWordPressCommentSourceKey(comment);
			if (
				comment.parentOldCommentId &&
				!oldCommentIds.has(comment.parentOldCommentId)
			) {
				conflicts += 1;
				items.push({
					type: "comment",
					status: "conflict",
					sourceKey,
					pageKey: item.pageKey,
					message: `parent comment is missing: ${comment.parentOldCommentId}`,
				});
				continue;
			}
			if (input.maxDepth && comment.depth > input.maxDepth) {
				warnings += 1;
				items.push({
					type: "comment",
					status: "warning",
					sourceKey,
					pageKey: item.pageKey,
					message: `comment depth exceeds max depth: ${comment.depth}`,
				});
			}
			if (comment.createdAt && Number.isNaN(Date.parse(comment.createdAt))) {
				conflicts += 1;
				items.push({
					type: "comment",
					status: "conflict",
					sourceKey,
					pageKey: item.pageKey,
					message: `createdAt is invalid: ${comment.createdAt}`,
				});
				continue;
			}
			if (input.existingSourceKeys.has(sourceKey)) {
				if (input.existingStrategy === "skip_existing") {
					willSkipExistingComments += 1;
					items.push({
						type: "comment",
						status: "skip",
						sourceKey,
						pageKey: item.pageKey,
						message: "source key was already imported",
					});
				} else {
					conflicts += 1;
					items.push({
						type: "comment",
						status: "conflict",
						sourceKey,
						pageKey: item.pageKey,
						message: "source key was already imported",
					});
				}
				continue;
			}
			willCreateComments += 1;
			items.push({
				type: "comment",
				status: "create",
				sourceKey,
				pageKey: item.pageKey,
				message: "comment will be created",
			});
		}
	}

	return {
		summary: {
			willCreatePageThreads: pageKeys.filter(
				(pageKey) => !input.existingPageKeys.has(pageKey),
			).length,
			willReusePageThreads: pageKeys.filter((pageKey) =>
				input.existingPageKeys.has(pageKey),
			).length,
			willCreateComments,
			willSkipExistingComments,
			conflicts,
			warnings,
		},
		items,
	};
}
