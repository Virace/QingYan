import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	integer,
	pgTable,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { jsonText, exactText as text, utcTimestamp } from "./column-types";

import { sites } from "./sites";

export const siteSettings = pgTable(
	"site_settings",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		commentsEnabled: boolean("comments_enabled").notNull().default(true),
		defaultStatus: text("default_status").notNull().default("pending"),
		maxDepth: integer("max_depth").notNull().default(3),
		rootLimit: integer("root_limit").notNull().default(20),
		commentRequireJson: jsonText("comment_require_json")
			.notNull()
			.default('["nickname","email"]'),
		allowWebsite: boolean("allow_website").notNull().default(true),
		allowPageLike: boolean("allow_page_like").notNull().default(true),
		captchaMode: text("captcha_mode").notNull().default("threshold"),
		captchaThresholdWindowSec: integer("captcha_threshold_window_sec")
			.notNull()
			.default(60),
		captchaThresholdMaxActions: integer("captcha_threshold_max_actions")
			.notNull()
			.default(3),
		abuseGuardEnabled: boolean("abuse_guard_enabled").notNull().default(true),
		abuseGuardWindowSec: integer("abuse_guard_window_sec")
			.notNull()
			.default(600),
		abuseGuardMaxWriteActions: integer("abuse_guard_max_write_actions")
			.notNull()
			.default(100),
		autoBlacklistEnabled: boolean("auto_blacklist_enabled")
			.notNull()
			.default(true),
		autoBlacklistScope: text("auto_blacklist_scope").notNull().default("post"),
		autoBlacklistTtlSec: integer("auto_blacklist_ttl_sec")
			.notNull()
			.default(1800),
		commentInputLimitsJson: jsonText("comment_input_limits_json"),
		commentMetadataJson: jsonText("comment_metadata_json"),
		engagementJson: jsonText("engagement_json"),
		verifiedAuthorJson: jsonText("verified_author_json"),
		staffDisplayJson: jsonText("staff_display_json"),
		moderationJson: jsonText("moderation_json"),
		pageRegistryJson: jsonText("page_registry_json"),
		commenterReplyEmailEnabled: boolean("commenter_reply_email_enabled")
			.notNull()
			.default(false),
		commenterReplyEmailDefaultChecked: boolean(
			"commenter_reply_email_default_checked",
		)
			.notNull()
			.default(false),
		backendNotificationsEnabled: boolean("backend_notifications_enabled")
			.notNull()
			.default(false),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex("site_settings_site_id_idx").on(table.siteId)],
);
