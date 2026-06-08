import { sql } from "drizzle-orm";
import {
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { sites } from "./sites";

export const siteSettings = sqliteTable(
	"site_settings",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		commentsEnabled: integer("comments_enabled", { mode: "boolean" })
			.notNull()
			.default(true),
		defaultStatus: text("default_status").notNull().default("pending"),
		maxDepth: integer("max_depth").notNull().default(3),
		rootLimit: integer("root_limit").notNull().default(20),
		commentRequireJson: text("comment_require_json")
			.notNull()
			.default('["nickname","email"]'),
		allowWebsite: integer("allow_website", { mode: "boolean" })
			.notNull()
			.default(true),
		allowPageLike: integer("allow_page_like", { mode: "boolean" })
			.notNull()
			.default(true),
		captchaMode: text("captcha_mode").notNull().default("threshold"),
		captchaThresholdWindowSec: integer("captcha_threshold_window_sec")
			.notNull()
			.default(60),
		captchaThresholdMaxActions: integer("captcha_threshold_max_actions")
			.notNull()
			.default(3),
		abuseGuardEnabled: integer("abuse_guard_enabled", { mode: "boolean" })
			.notNull()
			.default(true),
		abuseGuardWindowSec: integer("abuse_guard_window_sec")
			.notNull()
			.default(600),
		abuseGuardMaxWriteActions: integer("abuse_guard_max_write_actions")
			.notNull()
			.default(100),
		autoBlacklistEnabled: integer("auto_blacklist_enabled", {
			mode: "boolean",
		})
			.notNull()
			.default(true),
		autoBlacklistScope: text("auto_blacklist_scope").notNull().default("post"),
		autoBlacklistTtlSec: integer("auto_blacklist_ttl_sec")
			.notNull()
			.default(1800),
		commentInputLimitsJson: text("comment_input_limits_json"),
		commentMetadataJson: text("comment_metadata_json"),
		engagementJson: text("engagement_json"),
		verifiedAuthorJson: text("verified_author_json"),
		staffDisplayJson: text("staff_display_json"),
		moderationJson: text("moderation_json"),
		pageRegistryJson: text("page_registry_json"),
		commenterReplyEmailEnabled: integer("commenter_reply_email_enabled", {
			mode: "boolean",
		})
			.notNull()
			.default(false),
		backendNotificationsEnabled: integer("backend_notifications_enabled", {
			mode: "boolean",
		})
			.notNull()
			.default(false),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex("site_settings_site_id_idx").on(table.siteId)],
);
