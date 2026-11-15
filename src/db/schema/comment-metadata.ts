import { sql } from "drizzle-orm";
import { bigint, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { exactText as text, utcTimestamp } from "./column-types";

import { comments } from "./comments";

export const commentRequestMetadata = pgTable("comment_request_metadata", {
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
	createdAt: utcTimestamp("created_at")
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
	updatedAt: utcTimestamp("updated_at")
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
});

export const ipRegionDatabaseState = pgTable(
	"ip_region_database_state",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		ipVersion: text("ip_version").notNull(),
		filePath: text("file_path"),
		fileHash: text("file_hash"),
		sourceUrl: text("source_url"),
		cachePolicy: text("cache_policy"),
		activatedAt: utcTimestamp("activated_at"),
		updatedAt: utcTimestamp("updated_at").notNull(),
		lastCheckedAt: utcTimestamp("last_checked_at"),
		lastCheckStatus: text("last_check_status"),
		lastCheckReason: text("last_check_reason"),
		lastCheckError: text("last_check_error"),
	},
	(table) => [
		uniqueIndex("ip_region_database_state_version_idx").on(table.ipVersion),
	],
);
