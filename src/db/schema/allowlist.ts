import { sql } from "drizzle-orm";
import { bigint, index, pgTable } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";
import { exactText as text, utcTimestamp } from "./column-types";
import { sites } from "./sites";

export const allowlistRules = pgTable(
	"allowlist_rules",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		siteId: bigint("site_id", { mode: "number" }).references(() => sites.id),
		targetType: text("target_type").notNull(),
		matchMode: text("match_mode").notNull(),
		targetValue: text("target_value").notNull(),
		scope: text("scope").notNull().default("all"),
		reason: text("reason"),
		expiresAt: utcTimestamp("expires_at"),
		createdByUserId: bigint("created_by_user_id", {
			mode: "number",
		}).references(() => adminUsers.id),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		deletedAt: utcTimestamp("deleted_at"),
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
