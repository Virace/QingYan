import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { comments } from "./comments";

export const commentModeration = sqliteTable(
	"comment_moderation",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
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
		checkedAt: text("checked_at"),
		requestSnapshotJson: text("request_snapshot_json"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("comment_moderation_comment_idx").on(table.commentId),
		index("comment_moderation_status_idx").on(table.status),
	],
);
