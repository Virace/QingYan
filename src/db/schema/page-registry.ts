import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	index,
	integer,
	pgTable,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { bytea, exactText as text, utcTimestamp } from "./column-types";

import { sites } from "./sites";

export const sitePageRegistry = pgTable(
	"site_page_registry",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		pageKey: text("page_key").notNull(),
		pageKeyHash: bytea("page_key_hash").notNull(),
		pageUrl: text("page_url").notNull(),
		title: text("title"),
		status: text("status").notNull().default("active"),
		titleRefreshAttemptedAt: utcTimestamp("title_refresh_attempted_at"),
		titleRefreshedAt: utcTimestamp("title_refreshed_at"),
		titleRefreshStatusCode: integer("title_refresh_status_code"),
		titleRefreshError: text("title_refresh_error"),
		firstSeenAt: utcTimestamp("first_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		lastSeenAt: utcTimestamp("last_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		trashedAt: utcTimestamp("trashed_at"),
		deletedAt: utcTimestamp("deleted_at"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		check(
			"site_page_registry_page_key_hash_length",
			sql`octet_length(${table.pageKeyHash}) = 32`,
		),
		uniqueIndex("site_page_registry_site_page_key_idx").on(
			table.siteId,
			table.pageKeyHash,
		),
		index("site_page_registry_site_status_idx").on(table.siteId, table.status),
	],
);

export const pendingPageCandidates = pgTable(
	"pending_page_candidates",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		siteKey: text("site_key").notNull(),
		pageKey: text("page_key").notNull(),
		pageKeyHash: bytea("page_key_hash").notNull(),
		pageUrl: text("page_url").notNull(),
		firstSeenAt: utcTimestamp("first_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		lastSeenAt: utcTimestamp("last_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		hitCount: bigint("hit_count", { mode: "number" }).notNull().default(0),
		status: text("status").notNull().default("pending"),
		lastRejectReason: text("last_reject_reason"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		check(
			"pending_page_candidates_hit_count_nonnegative",
			sql`${table.hitCount} >= 0`,
		),
		check(
			"pending_page_candidates_page_key_hash_length",
			sql`octet_length(${table.pageKeyHash}) = 32`,
		),
		uniqueIndex("pending_page_candidates_site_page_key_idx").on(
			table.siteKey,
			table.pageKeyHash,
		),
		index("pending_page_candidates_site_status_idx").on(
			table.siteKey,
			table.status,
		),
	],
);

export const pendingPageViewSessions = pgTable(
	"pending_page_view_sessions",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		siteKey: text("site_key").notNull(),
		pageKey: text("page_key").notNull(),
		pageKeyHash: bytea("page_key_hash").notNull(),
		fingerprint: text("fingerprint").notNull(),
		firstSeenAt: utcTimestamp("first_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		lastSeenAt: utcTimestamp("last_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		hitCount: bigint("hit_count", { mode: "number" }).notNull().default(1),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		check(
			"pending_page_view_sessions_hit_count_nonnegative",
			sql`${table.hitCount} >= 0`,
		),
		check(
			"pending_page_view_sessions_page_key_hash_length",
			sql`octet_length(${table.pageKeyHash}) = 32`,
		),
		uniqueIndex("pending_page_view_sessions_page_fingerprint_idx").on(
			table.siteKey,
			table.pageKeyHash,
			table.fingerprint,
		),
		index("pending_page_view_sessions_site_page_idx").on(
			table.siteKey,
			table.pageKeyHash,
		),
	],
);
