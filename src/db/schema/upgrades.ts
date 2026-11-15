import { sql } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { jsonText, exactText as text, utcTimestamp } from "./column-types";

export const applicationUpgrades = pgTable("__qingyan_upgrades", {
	name: text("name").primaryKey().notNull(),
	fromVersion: text("from_version"),
	toVersion: text("to_version"),
	appliedAt: utcTimestamp("applied_at")
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
	summaryJson: jsonText("summary_json").notNull(),
});
