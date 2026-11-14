import { sql } from "drizzle-orm";
import {
	bigint,
	index,
	integer,
	pgTable,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { jsonText, exactText as text, utcTimestamp } from "./column-types";

import { comments } from "./comments";

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
