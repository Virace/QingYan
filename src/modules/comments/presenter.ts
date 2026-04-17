interface PresenterCommentInput {
	id: string;
	parentId: string | null;
	authorName: string;
	authorWebsite: string | null;
	contentRaw: string;
	contentHtml: string | null;
	status: string;
	isPinned: boolean;
	isFolded: boolean;
	replyCount: number;
	voteUpCount: number;
	voteDownCount: number;
	createdAt: string;
	updatedAt: string;
}

function toPublicTimestamp(value: string | null): string | null {
	if (!value) {
		return null;
	}

	const normalized = value.includes("T")
		? value
		: `${value.replace(" ", "T")}Z`;
	const timestamp = new Date(normalized);
	return Number.isNaN(timestamp.getTime()) ? value : timestamp.toISOString();
}

function renderHtml(raw: string, existingHtml: string | null): string {
	if (existingHtml) {
		return existingHtml;
	}

	return `<p>${raw
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")}</p>`;
}

export function presentComments(
	comments: PresenterCommentInput[],
	viewerVoteMap: Map<string, "up" | "down">,
) {
	const nodes = new Map<string, Record<string, unknown>>();
	const rootNodes: Array<Record<string, unknown>> = [];

	for (const comment of comments) {
		nodes.set(comment.id, {
			id: comment.id,
			parentId: comment.parentId,
			author: {
				name: comment.authorName,
				website: comment.authorWebsite ?? undefined,
			},
			content: {
				raw: comment.contentRaw,
				html: renderHtml(comment.contentRaw, comment.contentHtml),
			},
			status: comment.status,
			isPinned: comment.isPinned,
			isFolded: comment.isFolded,
			replyCount: comment.replyCount,
			voteUp: comment.voteUpCount,
			voteDown: comment.voteDownCount,
			viewerVote: viewerVoteMap.get(comment.id) ?? null,
			createdAt: toPublicTimestamp(comment.createdAt),
			updatedAt: toPublicTimestamp(comment.updatedAt),
			children: [],
		});
	}

	for (const comment of comments) {
		const node = nodes.get(comment.id);
		if (!node) {
			continue;
		}

		if (comment.parentId) {
			const parentNode = nodes.get(comment.parentId);
			const children = parentNode?.children;
			if (Array.isArray(children)) {
				children.push(node);
			}
			continue;
		}

		rootNodes.push(node);
	}

	return rootNodes;
}
