import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const applicationUpgrades = sqliteTable("__qingyan_upgrades", {
	name: text("name").primaryKey().notNull(),
	fromVersion: text("from_version"),
	toVersion: text("to_version"),
	appliedAt: text("applied_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	summaryJson: text("summary_json").notNull(),
});
