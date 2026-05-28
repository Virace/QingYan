import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { sites } from "./sites";

export const sitePageRegistry = sqliteTable(
	"site_page_registry",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		pageKey: text("page_key").notNull(),
		pageUrl: text("page_url").notNull(),
		title: text("title"),
		status: text("status").notNull().default("active"),
		firstSeenAt: text("first_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		trashedAt: text("trashed_at"),
		deletedAt: text("deleted_at"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("site_page_registry_site_page_key_idx").on(
			table.siteId,
			table.pageKey,
		),
		index("site_page_registry_site_status_idx").on(table.siteId, table.status),
	],
);

export const pendingPageCandidates = sqliteTable(
	"pending_page_candidates",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		siteKey: text("site_key").notNull(),
		pageKey: text("page_key").notNull(),
		pageUrl: text("page_url").notNull(),
		firstSeenAt: text("first_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		hitCount: integer("hit_count").notNull().default(0),
		status: text("status").notNull().default("pending"),
		lastRejectReason: text("last_reject_reason"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("pending_page_candidates_site_page_key_idx").on(
			table.siteKey,
			table.pageKey,
		),
		index("pending_page_candidates_site_status_idx").on(
			table.siteKey,
			table.status,
		),
	],
);

export const pendingPageViewSessions = sqliteTable(
	"pending_page_view_sessions",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		siteKey: text("site_key").notNull(),
		pageKey: text("page_key").notNull(),
		fingerprint: text("fingerprint").notNull(),
		firstSeenAt: text("first_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		hitCount: integer("hit_count").notNull().default(1),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("pending_page_view_sessions_page_fingerprint_idx").on(
			table.siteKey,
			table.pageKey,
			table.fingerprint,
		),
		index("pending_page_view_sessions_site_page_idx").on(
			table.siteKey,
			table.pageKey,
		),
	],
);
