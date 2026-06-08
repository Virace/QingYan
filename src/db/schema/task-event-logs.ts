import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { taskRuns } from "./task-runs";

export const taskEventLogs = sqliteTable(
	"task_event_logs",
	{
		id: text("id").primaryKey(),
		taskRunId: text("task_run_id")
			.notNull()
			.references(() => taskRuns.id),
		sequence: integer("sequence").notNull().default(0),
		stream: text("stream").notNull().default("system"),
		eventType: text("event_type").notNull(),
		level: text("level").notNull(),
		message: text("message").notNull(),
		dataJson: text("data_json"),
		visibleToSiteAdmin: integer("visible_to_site_admin", {
			mode: "boolean",
		})
			.notNull()
			.default(false),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("task_event_logs_run_sequence_idx").on(
			table.taskRunId,
			table.sequence,
		),
		index("task_event_logs_run_created_idx").on(
			table.taskRunId,
			table.createdAt,
		),
		index("task_event_logs_level_created_idx").on(table.level, table.createdAt),
	],
);
