import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	foreignKey,
	index,
	pgTable,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { exactText as text, utcTimestamp } from "./column-types";

import { sites } from "./sites";

export const visitors = pgTable(
	"visitors",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		visitorKey: text("visitor_key").notNull(),
		ipHash: text("ip_hash"),
		userAgentHash: text("user_agent_hash"),
		lastIp: text("last_ip"),
		lastUserAgent: text("last_user_agent"),
		lastSeenPageKey: text("last_seen_page_key"),
		lastSeenPageUrl: text("last_seen_page_url"),
		lastSeenAt: utcTimestamp("last_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		unique("visitors_id_site_unique").on(table.id, table.siteId),
		uniqueIndex("visitors_site_visitor_key_idx").on(
			table.siteId,
			table.visitorKey,
		),
		index("visitors_site_id_idx").on(table.siteId),
	],
);

export const visitorRequestMetadata = pgTable(
	"visitor_request_metadata",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		visitorId: bigint("visitor_id", { mode: "number" })
			.notNull()
			.references(() => visitors.id),
		ip: text("ip"),
		ipHash: text("ip_hash"),
		userAgent: text("user_agent"),
		userAgentHash: text("user_agent_hash"),
		ipCountry: text("ip_country"),
		ipRegion: text("ip_region"),
		ipCity: text("ip_city"),
		ipIsp: text("ip_isp"),
		ipLocationRaw: text("ip_location_raw"),
		ipLocationSource: text("ip_location_source"),
		ipLocationDbHash: text("ip_location_db_hash"),
		ipLocationUpdatedAt: utcTimestamp("ip_location_updated_at"),
		ipLocationError: text("ip_location_error"),
		deviceBrowser: text("device_browser"),
		deviceBrowserVersion: text("device_browser_version"),
		deviceOs: text("device_os"),
		deviceOsVersion: text("device_os_version"),
		deviceType: text("device_type"),
		deviceIcon: text("device_icon"),
		deviceSource: text("device_source"),
		deviceParserVersion: text("device_parser_version"),
		deviceUpdatedAt: utcTimestamp("device_updated_at"),
		deviceError: text("device_error"),
		firstSeenAt: utcTimestamp("first_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		lastSeenAt: utcTimestamp("last_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		seenCount: bigint("seen_count", { mode: "number" }).notNull().default(1),
		lastSeenPageKey: text("last_seen_page_key"),
		lastSeenPageUrl: text("last_seen_page_url"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		check(
			"visitor_request_metadata_seen_count_nonnegative",
			sql`${table.seenCount} >= 0`,
		),
		foreignKey({
			name: "visitor_metadata_site_fk",
			columns: [table.visitorId, table.siteId],
			foreignColumns: [visitors.id, visitors.siteId],
		}),
		index("visitor_request_metadata_site_id_idx").on(table.siteId),
		index("visitor_request_metadata_visitor_id_idx").on(table.visitorId),
		index("visitor_request_metadata_last_seen_at_idx").on(table.lastSeenAt),
		unique("visitor_request_metadata_identity_idx")
			.on(table.visitorId, table.ipHash, table.userAgentHash)
			.nullsNotDistinct(),
	],
);
