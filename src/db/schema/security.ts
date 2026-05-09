import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { sites } from "./sites";

export const blacklistRules = sqliteTable(
	"blacklist_rules",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		siteId: integer("site_id").references(() => sites.id),
		scope: text("scope").notNull().default("post"),
		targetType: text("target_type").notNull(),
		targetValue: text("target_value").notNull(),
		matchMode: text("match_mode").notNull().default("exact"),
		reason: text("reason"),
		source: text("source").notNull().default("manual"),
		expiresAt: text("expires_at"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("blacklist_rules_target_idx").on(table.targetType, table.targetValue),
	],
);

export const adminSessions = sqliteTable(
	"admin_sessions",
	{
		id: text("id").primaryKey(),
		tokenHash: text("token_hash").notNull(),
		csrfTokenHash: text("csrf_token_hash"),
		csrfIssuedAt: text("csrf_issued_at"),
		ip: text("ip"),
		userAgent: text("user_agent"),
		expiresAt: text("expires_at").notNull(),
		lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index("admin_sessions_expires_at_idx").on(table.expiresAt)],
);

export const auditLogs = sqliteTable(
	"audit_logs",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		siteId: integer("site_id").references(() => sites.id),
		actorType: text("actor_type").notNull(),
		actorId: text("actor_id"),
		action: text("action").notNull(),
		targetType: text("target_type"),
		targetId: text("target_id"),
		payloadJson: text("payload_json"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index("audit_logs_action_idx").on(table.action)],
);
