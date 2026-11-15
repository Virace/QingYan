import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	bigint,
	boolean,
	check,
	foreignKey,
	index,
	pgTable,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";
import { exactText as text, utcTimestamp } from "./column-types";
import { pageThreads } from "./page-threads";
import { sites } from "./sites";
import { visitors } from "./visitors";

export const comments = pgTable(
	"comments",
	{
		id: text("id").primaryKey(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		pageThreadId: bigint("page_thread_id", { mode: "number" })
			.notNull()
			.references(() => pageThreads.id),
		parentId: text("parent_id").references((): AnyPgColumn => comments.id),
		visitorId: bigint("visitor_id", { mode: "number" }).references(
			() => visitors.id,
		),
		authorUserId: bigint("author_user_id", { mode: "number" }).references(
			() => adminUsers.id,
		),
		authorIdentity: text("author_identity").notNull().default("visitor"),
		status: text("status").notNull().default("pending"),
		authorName: text("author_name").notNull(),
		authorEmail: text("author_email"),
		authorEmailHash: text("author_email_hash"),
		authorWebsite: text("author_website"),
		contentRaw: text("content_raw").notNull(),
		contentHtml: text("content_html"),
		isPinned: boolean("is_pinned").notNull().default(false),
		isFolded: boolean("is_folded").notNull().default(false),
		replyCount: bigint("reply_count", { mode: "number" }).notNull().default(0),
		voteUpCount: bigint("vote_up_count", { mode: "number" })
			.notNull()
			.default(0),
		voteDownCount: bigint("vote_down_count", { mode: "number" })
			.notNull()
			.default(0),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		deletedAt: utcTimestamp("deleted_at"),
		approvedAt: utcTimestamp("approved_at"),
		approvalSource: text("approval_source"),
		approvedByUserId: bigint("approved_by_user_id", {
			mode: "number",
		}).references(() => adminUsers.id),
	},
	(table) => [
		unique("comments_id_thread_unique").on(table.id, table.pageThreadId),
		foreignKey({
			name: "comments_thread_site_fk",
			columns: [table.pageThreadId, table.siteId],
			foreignColumns: [pageThreads.id, pageThreads.siteId],
		}),
		foreignKey({
			name: "comments_parent_thread_fk",
			columns: [table.parentId, table.pageThreadId],
			foreignColumns: [table.id, table.pageThreadId],
		}),
		foreignKey({
			name: "comments_visitor_site_fk",
			columns: [table.visitorId, table.siteId],
			foreignColumns: [visitors.id, visitors.siteId],
		}),
		check("comments_reply_count_nonnegative", sql`${table.replyCount} >= 0`),
		check("comments_vote_up_count_nonnegative", sql`${table.voteUpCount} >= 0`),
		check(
			"comments_vote_down_count_nonnegative",
			sql`${table.voteDownCount} >= 0`,
		),
		check(
			"comments_status_check",
			sql`${table.status} IN ('pending', 'approved', 'spam', 'trash')`,
		),
		index("comments_thread_idx").on(table.pageThreadId),
		index("comments_parent_idx").on(table.parentId),
		index("comments_visitor_idx").on(table.visitorId),
		index("comments_site_email_history_idx").on(
			table.siteId,
			table.authorEmailHash,
			table.approvedAt,
		),
	],
);

export const voteRecords = pgTable(
	"vote_records",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		commentId: text("comment_id")
			.notNull()
			.references(() => comments.id),
		visitorId: bigint("visitor_id", { mode: "number" })
			.notNull()
			.references(() => visitors.id),
		choice: text("choice").notNull(),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		check("vote_records_choice_check", sql`${table.choice} IN ('up', 'down')`),
		uniqueIndex("vote_records_comment_visitor_idx").on(
			table.commentId,
			table.visitorId,
		),
		index("vote_records_visitor_idx").on(table.visitorId),
	],
);
