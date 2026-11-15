import { sql } from "drizzle-orm";
import { bigint, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { jsonText, exactText as text, utcTimestamp } from "./column-types";

export const sites = pgTable(
	"sites",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		siteKey: text("site_key").notNull(),
		name: text("name").notNull(),
		allowedOriginsJson: jsonText("allowed_origins_json").notNull(),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex("sites_site_key_idx").on(table.siteKey)],
);
