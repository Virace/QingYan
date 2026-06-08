import {
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

import { comments } from "./comments";

export const commentRequestMetadata = sqliteTable("comment_request_metadata", {
	commentId: text("comment_id")
		.primaryKey()
		.references(() => comments.id),
	authorIp: text("author_ip"),
	authorUserAgent: text("author_user_agent"),
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
	createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ipRegionDatabaseState = sqliteTable(
	"ip_region_database_state",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		ipVersion: text("ip_version").notNull(),
		filePath: text("file_path").notNull(),
		fileHash: text("file_hash").notNull(),
		sourceUrl: text("source_url"),
		cachePolicy: text("cache_policy").notNull(),
		activatedAt: text("activated_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("ip_region_database_state_version_idx").on(table.ipVersion),
	],
);

export const ipRegionUpdateRuns = sqliteTable("ip_region_update_runs", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	ipVersion: text("ip_version").notNull(),
	sourceUrl: text("source_url"),
	status: text("status").notNull(),
	previousHash: text("previous_hash"),
	nextHash: text("next_hash"),
	downloadedAt: text("downloaded_at"),
	activatedAt: text("activated_at"),
	refreshedComments: integer("refreshed_comments").notNull().default(0),
	errorMessage: text("error_message"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});
