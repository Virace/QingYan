import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	index,
	pgTable,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { bytea, exactText as text, utcTimestamp } from "./column-types";

import { sites } from "./sites";

export type PageThreadKind = "public" | "notification_test";

export const pageThreads = pgTable(
	"page_threads",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		pageKey: text("page_key").notNull(),
		pageKeyHash: bytea("page_key_hash").notNull(),
		pageTitle: text("page_title"),
		pageUrl: text("page_url"),
		kind: text("kind", {
			enum: ["public", "notification_test"],
		})
			.notNull()
			.default("public"),
		commentCount: bigint("comment_count", { mode: "number" })
			.notNull()
			.default(0),
		rootCommentCount: bigint("root_comment_count", { mode: "number" })
			.notNull()
			.default(0),
		pageViewCount: bigint("page_view_count", { mode: "number" })
			.notNull()
			.default(0),
		pageLikeCount: bigint("page_like_count", { mode: "number" })
			.notNull()
			.default(0),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		unique("page_threads_id_site_unique").on(table.id, table.siteId),
		check(
			"page_threads_comment_count_nonnegative",
			sql`${table.commentCount} >= 0`,
		),
		check(
			"page_threads_root_comment_count_nonnegative",
			sql`${table.rootCommentCount} >= 0`,
		),
		check(
			"page_threads_page_view_count_nonnegative",
			sql`${table.pageViewCount} >= 0`,
		),
		check(
			"page_threads_page_like_count_nonnegative",
			sql`${table.pageLikeCount} >= 0`,
		),
		check(
			"page_threads_page_key_hash_length",
			sql`octet_length(${table.pageKeyHash}) = 32`,
		),
		check(
			"page_threads_kind_check",
			sql`${table.kind} IN ('public', 'notification_test')`,
		),
		uniqueIndex("page_threads_site_page_key_idx").on(
			table.siteId,
			table.pageKeyHash,
		),
		index("page_threads_site_id_idx").on(table.siteId),
	],
);
