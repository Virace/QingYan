import { eq } from "drizzle-orm";
import type { DatabaseExecutor } from "../../db/client";
import {
	comments,
	pageThreads,
	sites,
	siteSettings,
	commentRequestMetadata,
	commentModeration,
} from "../../db/schema";

export async function captureCommentEventSnapshot(
	db: DatabaseExecutor,
	commentId: string,
) {
	const [snapshot] = await db
		.select({
			comment: comments,
			thread: pageThreads,
			site: sites,
			settings: {
				verifiedAuthorJson: siteSettings.verifiedAuthorJson,
				commentMetadataJson: siteSettings.commentMetadataJson,
			},
			metadata: commentRequestMetadata,
			moderation: {
				reason: commentModeration.reason,
				akismetVerdict: commentModeration.akismetVerdict,
			},
		})
		.from(comments)
		.innerJoin(pageThreads, eq(pageThreads.id, comments.pageThreadId))
		.innerJoin(sites, eq(sites.id, comments.siteId))
		.leftJoin(siteSettings, eq(siteSettings.siteId, comments.siteId))
		.leftJoin(
			commentRequestMetadata,
			eq(commentRequestMetadata.commentId, comments.id),
		)
		.leftJoin(commentModeration, eq(commentModeration.commentId, comments.id))
		.where(eq(comments.id, commentId))
		.limit(1);
	if (!snapshot) return null;
	const [parent] = snapshot.comment.parentId
		? await db
				.select()
				.from(comments)
				.where(eq(comments.id, snapshot.comment.parentId))
				.limit(1)
		: [];
	return { ...snapshot, parent: parent ?? null };
}

export type CommentEventSnapshot = NonNullable<
	Awaited<ReturnType<typeof captureCommentEventSnapshot>>
>;

export function readCommentEventSnapshot(
	payload: unknown,
): CommentEventSnapshot | undefined {
	return payload && typeof payload === "object" && "commentSnapshot" in payload
		? (payload.commentSnapshot as CommentEventSnapshot | undefined)
		: undefined;
}

export function snapshotForContentLevel(
	snapshot: CommentEventSnapshot | null,
	level: string,
) {
	if (!snapshot) return null;
	const content = (raw: string) =>
		level === "none"
			? ""
			: level === "full"
				? raw
				: Array.from(raw).slice(0, 501).join("");
	return {
		...snapshot,
		comment: {
			...snapshot.comment,
			contentRaw: content(snapshot.comment.contentRaw),
			contentHtml: null,
		},
		parent: snapshot.parent
			? {
					...snapshot.parent,
					contentRaw:
						level === "none"
							? ""
							: Array.from(snapshot.parent.contentRaw).slice(0, 501).join(""),
					contentHtml: null,
				}
			: null,
	};
}
