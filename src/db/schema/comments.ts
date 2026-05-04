import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { pageThreads } from "./page-threads";
import { sites } from "./sites";
import { visitors } from "./visitors";

export const comments = sqliteTable(
	"comments",
	{
		id: text("id").primaryKey(),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		pageThreadId: integer("page_thread_id")
			.notNull()
			.references(() => pageThreads.id),
		parentId: text("parent_id").references((): AnySQLiteColumn => comments.id),
		visitorId: integer("visitor_id").references(() => visitors.id),
		status: text("status").notNull().default("pending"),
		authorName: text("author_name").notNull(),
		authorEmail: text("author_email"),
		authorEmailHash: text("author_email_hash"),
		authorWebsite: text("author_website"),
		authorIp: text("author_ip"),
		authorUserAgent: text("author_user_agent"),
		authorIpCountry: text("author_ip_country"),
		authorIpRegion: text("author_ip_region"),
		authorIpCity: text("author_ip_city"),
		authorIpIsp: text("author_ip_isp"),
		authorIpLocationRaw: text("author_ip_location_raw"),
		authorIpLocationSource: text("author_ip_location_source"),
		authorIpLocationDbHash: text("author_ip_location_db_hash"),
		authorIpLocationUpdatedAt: text("author_ip_location_updated_at"),
		authorIpLocationError: text("author_ip_location_error"),
		authorDeviceBrowser: text("author_device_browser"),
		authorDeviceOs: text("author_device_os"),
		authorDeviceType: text("author_device_type"),
		authorDeviceIcon: text("author_device_icon"),
		authorDeviceSource: text("author_device_source"),
		authorDeviceParserVersion: text("author_device_parser_version"),
		authorDeviceUpdatedAt: text("author_device_updated_at"),
		authorDeviceError: text("author_device_error"),
		contentRaw: text("content_raw").notNull(),
		contentHtml: text("content_html"),
		isPinned: integer("is_pinned", { mode: "boolean" })
			.notNull()
			.default(false),
		isFolded: integer("is_folded", { mode: "boolean" })
			.notNull()
			.default(false),
		replyCount: integer("reply_count").notNull().default(0),
		voteUpCount: integer("vote_up_count").notNull().default(0),
		voteDownCount: integer("vote_down_count").notNull().default(0),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		deletedAt: text("deleted_at"),
	},
	(table) => [
		index("comments_thread_idx").on(table.pageThreadId),
		index("comments_parent_idx").on(table.parentId),
		index("comments_visitor_idx").on(table.visitorId),
	],
);

export const voteRecords = sqliteTable(
	"vote_records",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		commentId: text("comment_id")
			.notNull()
			.references(() => comments.id),
		visitorId: integer("visitor_id")
			.notNull()
			.references(() => visitors.id),
		choice: text("choice").notNull(),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("vote_records_comment_visitor_idx").on(
			table.commentId,
			table.visitorId,
		),
		index("vote_records_visitor_idx").on(table.visitorId),
	],
);
