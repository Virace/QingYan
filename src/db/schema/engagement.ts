import { sql } from "drizzle-orm";
import { bigint, index, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { exactText as text, utcTimestamp } from "./column-types";

import { pageThreads } from "./page-threads";
import { visitors } from "./visitors";

export const pageViewSessions = pgTable(
	"page_view_sessions",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		pageThreadId: bigint("page_thread_id", { mode: "number" })
			.notNull()
			.references(() => pageThreads.id),
		visitorId: bigint("visitor_id", { mode: "number" }).references(
			() => visitors.id,
		),
		fingerprint: text("fingerprint").notNull(),
		seenAt: utcTimestamp("seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("page_view_sessions_thread_fingerprint_idx").on(
			table.pageThreadId,
			table.fingerprint,
		),
	],
);

export const pageFeedbackRecords = pgTable(
	"page_feedback_records",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		pageThreadId: bigint("page_thread_id", { mode: "number" })
			.notNull()
			.references(() => pageThreads.id),
		visitorId: bigint("visitor_id", { mode: "number" })
			.notNull()
			.references(() => visitors.id),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("page_feedback_records_thread_visitor_idx").on(
			table.pageThreadId,
			table.visitorId,
		),
		index("page_feedback_records_visitor_idx").on(table.visitorId),
	],
);
