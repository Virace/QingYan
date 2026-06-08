import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { sites } from "./sites";

export const visitors = sqliteTable(
	"visitors",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		visitorKey: text("visitor_key").notNull(),
		ipHash: text("ip_hash"),
		userAgentHash: text("user_agent_hash"),
		lastIp: text("last_ip"),
		lastUserAgent: text("last_user_agent"),
		lastSeenPageKey: text("last_seen_page_key"),
		lastSeenPageUrl: text("last_seen_page_url"),
		lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("visitors_site_visitor_key_idx").on(
			table.siteId,
			table.visitorKey,
		),
		index("visitors_site_id_idx").on(table.siteId),
	],
);

export const visitorRequestMetadata = sqliteTable(
	"visitor_request_metadata",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		visitorId: integer("visitor_id")
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
		ipLocationUpdatedAt: text("ip_location_updated_at"),
		ipLocationError: text("ip_location_error"),
		deviceBrowser: text("device_browser"),
		deviceBrowserVersion: text("device_browser_version"),
		deviceOs: text("device_os"),
		deviceOsVersion: text("device_os_version"),
		deviceType: text("device_type"),
		deviceIcon: text("device_icon"),
		deviceSource: text("device_source"),
		deviceParserVersion: text("device_parser_version"),
		deviceUpdatedAt: text("device_updated_at"),
		deviceError: text("device_error"),
		firstSeenAt: text("first_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		seenCount: integer("seen_count").notNull().default(1),
		lastSeenPageKey: text("last_seen_page_key"),
		lastSeenPageUrl: text("last_seen_page_url"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("visitor_request_metadata_site_id_idx").on(table.siteId),
		index("visitor_request_metadata_visitor_id_idx").on(table.visitorId),
		index("visitor_request_metadata_last_seen_at_idx").on(table.lastSeenAt),
		uniqueIndex("visitor_request_metadata_identity_idx").on(
			table.visitorId,
			table.ipHash,
			table.userAgentHash,
		),
	],
);
