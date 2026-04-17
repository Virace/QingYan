import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { pageThreads } from "./page-threads";
import { visitors } from "./visitors";

export const pageViewSessions = sqliteTable(
	"page_view_sessions",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		pageThreadId: integer("page_thread_id")
			.notNull()
			.references(() => pageThreads.id),
		visitorId: integer("visitor_id").references(() => visitors.id),
		fingerprint: text("fingerprint").notNull(),
		seenAt: text("seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("page_view_sessions_thread_fingerprint_idx").on(
			table.pageThreadId,
			table.fingerprint,
		),
	],
);

export const pageFeedbackRecords = sqliteTable(
	"page_feedback_records",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		pageThreadId: integer("page_thread_id")
			.notNull()
			.references(() => pageThreads.id),
		visitorId: integer("visitor_id")
			.notNull()
			.references(() => visitors.id),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("page_feedback_records_thread_visitor_idx").on(
			table.pageThreadId,
			table.visitorId,
		),
		index("page_feedback_records_visitor_idx").on(table.visitorId),
	],
);
