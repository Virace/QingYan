import { sql } from "drizzle-orm";
import { bigint, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { jsonText, exactText as text, utcTimestamp } from "./column-types";

export const systemSettings = pgTable(
	"system_settings",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		category: text("category").notNull(),
		key: text("key").notNull(),
		valueJson: jsonText("value_json").notNull(),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("system_settings_category_key_idx").on(
			table.category,
			table.key,
		),
	],
);
