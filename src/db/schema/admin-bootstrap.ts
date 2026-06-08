import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const adminBootstrapState = sqliteTable("admin_bootstrap_state", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	consolePath: text("console_path").notNull(),
	username: text("username").notNull(),
	passwordHash: text("password_hash").notNull(),
	generatedAt: text("generated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	passwordRotatedAt: text("password_rotated_at"),
});
