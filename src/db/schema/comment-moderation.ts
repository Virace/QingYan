import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	index,
	integer,
	pgTable,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { jsonText, exactText as text, utcTimestamp } from "./column-types";

import { comments } from "./comments";
import { adminUsers } from "./admin-users";

export const commentModeration = pgTable(
	"comment_moderation",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		commentId: text("comment_id")
			.notNull()
			.references(() => comments.id),
		provider: text("provider").notNull().default("none"),
		mode: text("mode").notNull(),
		decision: text("decision").notNull(),
		status: text("status").notNull(),
		reason: text("reason"),
		akismetVerdict: text("akismet_verdict"),
		akismetProTip: text("akismet_pro_tip"),
		akismetRecheckAfterSec: integer("akismet_recheck_after_sec"),
		akismetDebugHelp: text("akismet_debug_help"),
		checkedAt: utcTimestamp("checked_at"),
		requestSnapshotJson: jsonText("request_snapshot_json"),
		localReviewJson: jsonText("local_review_json"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("comment_moderation_comment_idx").on(table.commentId),
		index("comment_moderation_status_idx").on(table.status),
	],
);

export const commentReviewEvents = pgTable(
	"comment_review_events",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		commentId: text("comment_id")
			.notNull()
			.references(() => comments.id),
		actorUserId: bigint("actor_user_id", { mode: "number" }).references(
			() => adminUsers.id,
		),
		previousStatus: text("previous_status").notNull(),
		status: text("status").notNull(),
		contentChanged: boolean("content_changed").notNull().default(false),
		effectiveAt: utcTimestamp("effective_at").notNull(),
	},
	(table) => [
		index("comment_review_events_comment_idx").on(
			table.commentId,
			table.effectiveAt,
		),
	],
);
