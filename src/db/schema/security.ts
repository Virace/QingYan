import { sql } from "drizzle-orm";
import { bigint, index, pgTable } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";
import { jsonText, exactText as text, utcTimestamp } from "./column-types";
import { sites } from "./sites";

export const blacklistRules = pgTable(
	"blacklist_rules",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		siteId: bigint("site_id", { mode: "number" }).references(() => sites.id),
		scope: text("scope").notNull().default("post"),
		targetType: text("target_type").notNull(),
		targetValue: text("target_value").notNull(),
		matchMode: text("match_mode").notNull().default("exact"),
		reason: text("reason"),
		source: text("source").notNull().default("manual"),
		expiresAt: utcTimestamp("expires_at"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("blacklist_rules_target_idx").on(table.targetType, table.targetValue),
	],
);

export const adminSessions = pgTable(
	"admin_sessions",
	{
		id: text("id").primaryKey(),
		userId: bigint("user_id", { mode: "number" }).references(
			() => adminUsers.id,
		),
		tokenHash: text("token_hash").notNull(),
		csrfTokenHash: text("csrf_token_hash"),
		csrfIssuedAt: utcTimestamp("csrf_issued_at"),
		ip: text("ip"),
		userAgent: text("user_agent"),
		expiresAt: utcTimestamp("expires_at").notNull(),
		revokedAt: utcTimestamp("revoked_at"),
		revokedByUserId: bigint("revoked_by_user_id", {
			mode: "number",
		}).references(() => adminUsers.id),
		revocationReason: text("revocation_reason"),
		lastSeenAt: utcTimestamp("last_seen_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index("admin_sessions_expires_at_idx").on(table.expiresAt)],
);

export const auditLogs = pgTable(
	"audit_logs",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		siteId: bigint("site_id", { mode: "number" }).references(() => sites.id),
		actorType: text("actor_type").notNull(),
		actorId: text("actor_id"),
		action: text("action").notNull(),
		targetType: text("target_type"),
		targetId: text("target_id"),
		payloadJson: jsonText("payload_json"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index("audit_logs_action_idx").on(table.action)],
);
