import { sql } from "drizzle-orm";
import { bigint, pgTable } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";
import { exactText as text, utcTimestamp } from "./column-types";

export const adminBootstrapState = pgTable("admin_bootstrap_state", {
	id: bigint("id", { mode: "number" })
		.primaryKey()
		.generatedByDefaultAsIdentity(),
	consolePath: text("console_path").notNull(),
	initialAdminUserId: bigint("initial_admin_user_id", { mode: "number" })
		.notNull()
		.references(() => adminUsers.id),
	generatedAt: utcTimestamp("generated_at")
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
});
