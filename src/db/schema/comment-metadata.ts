import {
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
