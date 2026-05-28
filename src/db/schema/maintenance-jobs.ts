import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const maintenanceJobs = sqliteTable("maintenance_jobs", {
	id: text("id").primaryKey(),
	type: text("type").notNull(),
	status: text("status").notNull(),
	scopeJson: text("scope_json").notNull(),
	progressJson: text("progress_json"),
	resultJson: text("result_json"),
	errorJson: text("error_json"),
	createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	startedAt: text("started_at"),
	finishedAt: text("finished_at"),
	updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
