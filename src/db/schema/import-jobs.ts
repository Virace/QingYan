import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { sites } from "./sites";

export const importBatches = sqliteTable(
	"import_batches",
	{
		id: text("id").primaryKey(),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		sourceType: text("source_type").notNull(),
		sourceFileName: text("source_file_name").notNull(),
		sourceHash: text("source_hash").notNull(),
		format: text("format").notNull(),
		formatVersion: integer("format_version").notNull(),
		status: text("status").notNull(),
		summaryJson: text("summary_json").notNull(),
		optionsJson: text("options_json").notNull(),
		errorJson: text("error_json"),
		backupJson: text("backup_json"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		appliedAt: text("applied_at"),
	},
	(table) => [
		index("import_batches_site_status_idx").on(table.siteId, table.status),
	],
);

export const importRecords = sqliteTable(
	"import_records",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		batchId: text("batch_id")
			.notNull()
			.references(() => importBatches.id),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		sourceType: text("source_type").notNull(),
		sourceKey: text("source_key").notNull(),
		sourceParentKey: text("source_parent_key"),
		targetType: text("target_type").notNull(),
		targetId: text("target_id").notNull(),
		metadataJson: text("metadata_json").notNull(),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("import_records_site_source_key_idx").on(
			table.siteId,
			table.sourceType,
			table.sourceKey,
		),
		index("import_records_batch_idx").on(table.batchId),
	],
);
