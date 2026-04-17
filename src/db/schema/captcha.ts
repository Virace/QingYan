import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { pageThreads } from "./page-threads";
import { sites } from "./sites";
import { visitors } from "./visitors";

export const captchaSessions = sqliteTable(
	"captcha_sessions",
	{
		id: text("id").primaryKey(),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		visitorId: integer("visitor_id")
			.notNull()
			.references(() => visitors.id),
		pageThreadId: integer("page_thread_id").references(() => pageThreads.id),
		triggeredBy: text("triggered_by").notNull(),
		mode: text("mode").notNull(),
		challengePayloadJson: text("challenge_payload_json"),
		verified: integer("verified", { mode: "boolean" }).notNull().default(false),
		expiresAt: text("expires_at").notNull(),
		verifiedAt: text("verified_at"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("captcha_sessions_visitor_page_idx").on(
			table.visitorId,
			table.pageThreadId,
		),
	],
);
