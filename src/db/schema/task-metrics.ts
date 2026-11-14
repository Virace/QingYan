import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	doublePrecision,
	index,
	integer,
	pgTable,
	unique,
} from "drizzle-orm/pg-core";
import {
	bytea,
	jsonText,
	exactText as text,
	utcTimestamp,
} from "./column-types";

import { sites } from "./sites";

export const taskMetricRollups = pgTable(
	"task_metric_rollups",
	{
		id: text("id").primaryKey(),
		siteId: bigint("site_id", { mode: "number" }).references(() => sites.id),
		siteKey: text("site_key"),
		metricKey: text("metric_key").notNull(),
		bucketStartAt: utcTimestamp("bucket_start_at").notNull(),
		bucketSizeSec: integer("bucket_size_sec").notNull(),
		dimensionJson: jsonText("dimension_json").notNull(),
		dimensionHash: bytea("dimension_hash").notNull(),
		value: doublePrecision("value").notNull().default(0),
		sampleCount: bigint("sample_count", { mode: "number" })
			.notNull()
			.default(0),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		check(
			"task_metric_rollups_sample_count_nonnegative",
			sql`${table.sampleCount} >= 0`,
		),
		check(
			"task_metric_rollups_dimension_hash_length",
			sql`octet_length(${table.dimensionHash}) = 32`,
		),
		check(
			"task_metric_rollups_bucket_size_positive",
			sql`${table.bucketSizeSec} > 0`,
		),
		index("task_metric_rollups_site_metric_bucket_idx").on(
			table.siteId,
			table.metricKey,
			table.bucketStartAt,
		),
		index("task_metric_rollups_metric_bucket_idx").on(
			table.metricKey,
			table.bucketStartAt,
		),
		unique("task_metric_rollups_unique_bucket_idx")
			.on(
				table.siteKey,
				table.metricKey,
				table.bucketStartAt,
				table.bucketSizeSec,
				table.dimensionHash,
			)
			.nullsNotDistinct(),
	],
);
