import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { sites } from "./sites";

export type PageThreadKind = "public" | "notification_test";

export const pageThreads = sqliteTable(
	"page_threads",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		pageKey: text("page_key").notNull(),
		pageTitle: text("page_title"),
		pageUrl: text("page_url"),
		kind: text("kind", {
			enum: ["public", "notification_test"],
		})
			.notNull()
			.default("public"),
		commentCount: integer("comment_count").notNull().default(0),
		rootCommentCount: integer("root_comment_count").notNull().default(0),
		pageViewCount: integer("page_view_count").notNull().default(0),
		pageLikeCount: integer("page_like_count").notNull().default(0),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("page_threads_site_page_key_idx").on(
			table.siteId,
			table.pageKey,
		),
		index("page_threads_site_id_idx").on(table.siteId),
	],
);
