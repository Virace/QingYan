import { sql } from "drizzle-orm";
import {
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const sites = sqliteTable(
	"sites",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		siteKey: text("site_key").notNull(),
		name: text("name").notNull(),
		allowedOriginsJson: text("allowed_origins_json").notNull(),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex("sites_site_key_idx").on(table.siteKey)],
);
