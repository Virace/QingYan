import { sql } from "drizzle-orm";
import {
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { sites } from "./sites";

export const taskMetricRollups = sqliteTable(
	"task_metric_rollups",
	{
		id: text("id").primaryKey(),
		siteId: integer("site_id").references(() => sites.id),
		siteKey: text("site_key").notNull().default("__global__"),
		metricKey: text("metric_key").notNull(),
		bucketStartAt: text("bucket_start_at").notNull(),
		bucketSizeSec: integer("bucket_size_sec").notNull(),
		dimensionJson: text("dimension_json").notNull(),
		value: real("value").notNull().default(0),
		sampleCount: integer("sample_count").notNull().default(0),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("task_metric_rollups_site_metric_bucket_idx").on(
			table.siteId,
			table.metricKey,
			table.bucketStartAt,
		),
		index("task_metric_rollups_metric_bucket_idx").on(
			table.metricKey,
			table.bucketStartAt,
		),
		uniqueIndex("task_metric_rollups_unique_bucket_idx").on(
			table.siteKey,
			table.metricKey,
			table.bucketStartAt,
			table.bucketSizeSec,
			table.dimensionJson,
		),
	],
);
