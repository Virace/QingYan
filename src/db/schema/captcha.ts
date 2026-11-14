import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	foreignKey,
	index,
	pgTable,
} from "drizzle-orm/pg-core";
import { jsonText, exactText as text, utcTimestamp } from "./column-types";

import { pageThreads } from "./page-threads";
import { sites } from "./sites";
import { visitors } from "./visitors";

export const captchaSessions = pgTable(
	"captcha_sessions",
	{
		id: text("id").primaryKey(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		visitorId: bigint("visitor_id", { mode: "number" })
			.notNull()
			.references(() => visitors.id),
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
	],
);
