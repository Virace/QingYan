import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { adminUsers } from "./admin-users";
import { sites } from "./sites";

export const allowlistRules = sqliteTable(
	"allowlist_rules",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		siteId: integer("site_id").references(() => sites.id),
		targetType: text("target_type").notNull(),
		matchMode: text("match_mode").notNull(),
		targetValue: text("target_value").notNull(),
		scope: text("scope").notNull().default("all"),
		reason: text("reason"),
		expiresAt: text("expires_at"),
		createdByUserId: integer("created_by_user_id").references(
			() => adminUsers.id,
		),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		deletedAt: text("deleted_at"),
	},
	(table) => [
		index("allowlist_rules_site_target_idx").on(
			table.siteId,
			table.targetType,
			table.targetValue,
		),
		index("allowlist_rules_target_idx").on(table.targetType, table.targetValue),
		index("allowlist_rules_expires_at_idx").on(table.expiresAt),
	],
);
