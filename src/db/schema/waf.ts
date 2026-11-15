import { sql } from "drizzle-orm";
import {
	bigint,
	index,
	integer,
	pgTable,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { exactText as text, utcTimestamp } from "./column-types";
import { securityPenalties } from "./security";
import { sites } from "./sites";

export const wafSyncRecords = pgTable(
	"waf_sync_records",
	{
		id: text("id").primaryKey(),
		penaltyId: text("penalty_id")
			.notNull()
			.references(() => securityPenalties.id),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		ip: text("ip").notNull(),
		penaltyVersion: integer("penalty_version").notNull(),
		revision: integer("revision").notNull().default(1),
		ruleName: text("rule_name").notNull(),
		websiteId: bigint("website_id", { mode: "number" }),
		websiteKey: text("website_key"),
		expectedFingerprint: text("expected_fingerprint"),
		observedFingerprint: text("observed_fingerprint"),
		desiredState: text("desired_state").notNull(),
		observedState: text("observed_state").notNull().default("unknown"),
		syncState: text("sync_state").notNull().default("pending"),
		reasonCode: text("reason_code"),
		expiresAt: utcTimestamp("expires_at").notNull(),
		lastAttemptAt: utcTimestamp("last_attempt_at"),
		lastSyncedAt: utcTimestamp("last_synced_at"),
		suspendedAt: utcTimestamp("suspended_at"),
		restoreRequestedAt: utcTimestamp("restore_requested_at"),
		sharedIpConfirmedAt: utcTimestamp("shared_ip_confirmed_at"),
		claimToken: text("claim_token"),
		claimExpiresAt: utcTimestamp("claim_expires_at"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("waf_sync_penalty_idx").on(table.penaltyId),
		uniqueIndex("waf_sync_rule_idx").on(table.ruleName),
		index("waf_sync_site_idx").on(table.siteId, table.updatedAt),
	],
);

export const wafLogEvents = pgTable(
	"waf_log_events",
	{
		id: text("id").primaryKey(),
		siteId: bigint("site_id", { mode: "number" }).references(() => sites.id),
		sourceId: bigint("source_id", { mode: "number" }).notNull(),
		websiteKey: text("website_key").notNull(),
		ip: text("ip").notNull(),
		host: text("host").notNull(),
		path: text("path").notNull(),
		ruleType: text("rule_type").notNull(),
		action: text("action").notNull(),
		occurredAt: utcTimestamp("occurred_at").notNull(),
		commentId: text("comment_id"),
		confidence: text("confidence").notNull().default("unlinked"),
		decision: text("decision").notNull().default("observed"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("waf_events_site_time_idx").on(table.siteId, table.occurredAt),
	],
);

export const wafLogCursors = pgTable("waf_log_cursors", {
	websiteKey: text("website_key").primaryKey(),
	highWaterId: bigint("high_water_id", { mode: "number" }).notNull().default(0),
	lastPollAt: utcTimestamp("last_poll_at"),
	gapReason: text("gap_reason"),
	updatedAt: utcTimestamp("updated_at")
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
});
