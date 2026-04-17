import { sql } from "drizzle-orm";
import {
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const systemSettings = sqliteTable(
	"system_settings",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		category: text("category").notNull(),
		key: text("key").notNull(),
		valueJson: text("value_json").notNull(),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("system_settings_category_key_idx").on(
			table.category,
			table.key,
		),
	],
);
