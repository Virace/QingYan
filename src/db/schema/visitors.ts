import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { sites } from "./sites";

export const visitors = sqliteTable(
	"visitors",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		visitorKey: text("visitor_key").notNull(),
		ipHash: text("ip_hash"),
		userAgentHash: text("user_agent_hash"),
		lastIp: text("last_ip"),
		lastUserAgent: text("last_user_agent"),
		lastSeenPageKey: text("last_seen_page_key"),
		lastSeenPageUrl: text("last_seen_page_url"),
		lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("visitors_site_visitor_key_idx").on(
			table.siteId,
			table.visitorKey,
		),
		index("visitors_site_id_idx").on(table.siteId),
	],
);
