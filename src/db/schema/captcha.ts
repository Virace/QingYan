import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	foreignKey,
	index,
	pgTable,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { jsonText, exactText as text, utcTimestamp } from "./column-types";

import { pageThreads } from "./page-threads";
import { sites } from "./sites";
import { visitors } from "./visitors";

export const securitySubjects = pgTable(
	"security_subjects",
	{
		id: text("id").primaryKey(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		tokenHash: text("token_hash").notNull(),
		expiresAt: utcTimestamp("expires_at").notNull(),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("security_subjects_token_idx").on(
			table.siteId,
			table.tokenHash,
		),
	],
);

export const captchaSessions = pgTable(
	"captcha_sessions",
	{
		id: text("id").primaryKey(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		visitorId: bigint("visitor_id", { mode: "number" }).references(
			() => visitors.id,
		),
		subjectId: text("subject_id")
			.notNull()
			.references(() => securitySubjects.id, { onDelete: "cascade" }),
		action: text("action").notNull().default("comment_create"),
		pageThreadId: bigint("page_thread_id", { mode: "number" }).references(
			() => pageThreads.id,
		),
		triggeredBy: text("triggered_by").notNull(),
		mode: text("mode").notNull(),
		providerKind: text("provider_kind"),
		challengePayloadJson: jsonText("challenge_payload_json"),
		providerStateJson: jsonText("provider_state_json"),
		verified: boolean("verified").notNull().default(false),
		expiresAt: utcTimestamp("expires_at").notNull(),
		verifiedAt: utcTimestamp("verified_at"),
		grantExpiresAt: utcTimestamp("grant_expires_at"),
		reservationId: text("reservation_id"),
		reservedUntil: utcTimestamp("reserved_until"),
		consumedAt: utcTimestamp("consumed_at"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		foreignKey({
			name: "captcha_visitor_site_fk",
			columns: [table.visitorId, table.siteId],
			foreignColumns: [visitors.id, visitors.siteId],
		}),
		foreignKey({
			name: "captcha_thread_site_fk",
			columns: [table.pageThreadId, table.siteId],
			foreignColumns: [pageThreads.id, pageThreads.siteId],
		}),
		index("captcha_sessions_visitor_page_idx").on(
			table.visitorId,
			table.pageThreadId,
		),
		index("captcha_sessions_subject_action_idx").on(
			table.siteId,
			table.subjectId,
			table.action,
			table.createdAt,
		),
	],
);
