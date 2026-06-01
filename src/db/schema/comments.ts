import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { pageThreads } from "./page-threads";
import { adminUsers } from "./admin-users";
import { sites } from "./sites";
import { visitors } from "./visitors";

export const comments = sqliteTable(
	"comments",
	{
		id: text("id").primaryKey(),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		pageThreadId: integer("page_thread_id")
			.notNull()
			.references(() => pageThreads.id),
		parentId: text("parent_id").references((): AnySQLiteColumn => comments.id),
		visitorId: integer("visitor_id").references(() => visitors.id),
		authorUserId: integer("author_user_id").references(() => adminUsers.id),
		authorIdentity: text("author_identity").notNull().default("visitor"),
		status: text("status").notNull().default("pending"),
		authorName: text("author_name").notNull(),
		authorEmail: text("author_email"),
		authorEmailHash: text("author_email_hash"),
		authorWebsite: text("author_website"),
		contentRaw: text("content_raw").notNull(),
		contentHtml: text("content_html"),
		isPinned: integer("is_pinned", { mode: "boolean" })
			.notNull()
			.default(false),
		isFolded: integer("is_folded", { mode: "boolean" })
			.notNull()
			.default(false),
		replyCount: integer("reply_count").notNull().default(0),
		voteUpCount: integer("vote_up_count").notNull().default(0),
		voteDownCount: integer("vote_down_count").notNull().default(0),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		deletedAt: text("deleted_at"),
	},
	(table) => [
		index("comments_thread_idx").on(table.pageThreadId),
		index("comments_parent_idx").on(table.parentId),
		index("comments_visitor_idx").on(table.visitorId),
	],
);

export const voteRecords = sqliteTable(
	"vote_records",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		commentId: text("comment_id")
			.notNull()
			.references(() => comments.id),
		visitorId: integer("visitor_id")
			.notNull()
			.references(() => visitors.id),
		choice: text("choice").notNull(),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("vote_records_comment_visitor_idx").on(
			table.commentId,
			table.visitorId,
		),
		index("vote_records_visitor_idx").on(table.visitorId),
	],
);
