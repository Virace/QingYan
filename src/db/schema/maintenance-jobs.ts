import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const maintenanceJobs = sqliteTable("maintenance_jobs", {
	id: text("id").primaryKey(),
	type: text("type").notNull(),
	status: text("status").notNull(),
	siteKey: text("site_key"),
	scopeJson: text("scope_json").notNull(),
	progressJson: text("progress_json"),
	resultJson: text("result_json"),
	errorJson: text("error_json"),
	runAfter: text("run_after"),
	attempts: integer("attempts").notNull().default(0),
	maxAttempts: integer("max_attempts").notNull().default(1),
	retryDelaySec: integer("retry_delay_sec").notNull().default(0),
	priority: integer("priority").notNull().default(0),
	concurrencyKey: text("concurrency_key"),
	lastHeartbeatAt: text("last_heartbeat_at"),
	createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	startedAt: text("started_at"),
	finishedAt: text("finished_at"),
	updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
