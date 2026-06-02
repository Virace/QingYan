import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { adminUsers } from "./admin-users";
import { sites } from "./sites";

export const siteNotificationRecipients = sqliteTable(
	"site_notification_recipients",
	{
		id: text("id").primaryKey(),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		userId: integer("user_id")
			.notNull()
			.references(() => adminUsers.id),
		channelsJson: text("channels_json").notNull().default("[]"),
		eventsJson: text("events_json").notNull().default("[]"),
		includeCommentContent: text("include_comment_content").notNull(),
		rateLimitProfile: text("rate_limit_profile"),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("site_notification_recipients_site_user_idx").on(
			table.siteId,
			table.userId,
		),
		index("site_notification_recipients_site_idx").on(table.siteId),
		index("site_notification_recipients_user_idx").on(table.userId),
	],
);

export const notificationChannelConfigs = sqliteTable(
	"notification_channel_configs",
	{
		id: text("id").primaryKey(),
		type: text("type").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		configJson: text("config_json").notNull(),
		secretConfigJson: text("secret_config_json").notNull().default("{}"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("notification_channel_configs_type_idx").on(table.type),
		index("notification_channel_configs_enabled_idx").on(table.enabled),
	],
);

export const siteNotificationRecipientRoutes = sqliteTable(
	"site_notification_recipient_routes",
	{
		id: text("id").primaryKey(),
		recipientId: text("recipient_id")
			.notNull()
			.references(() => siteNotificationRecipients.id),
		eventType: text("event_type").notNull(),
		channelConfigId: text("channel_config_id")
			.notNull()
			.references(() => notificationChannelConfigs.id),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("site_notification_recipient_routes_recipient_idx").on(
			table.recipientId,
		),
		index("site_notification_recipient_routes_config_idx").on(
			table.channelConfigId,
		),
		uniqueIndex("site_notification_recipient_routes_unique_idx").on(
			table.recipientId,
			table.eventType,
			table.channelConfigId,
		),
	],
);

export const adminUserNotificationPreferences = sqliteTable(
	"admin_user_notification_preferences",
	{
		userId: integer("user_id")
			.notNull()
			.references(() => adminUsers.id),
		channel: text("channel").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		digestMode: text("digest_mode").notNull().default("off"),
		digestIntervalMinutes: integer("digest_interval_minutes"),
		digestTimesJson: text("digest_times_json"),
		pausedUntil: text("paused_until"),
		channelConfigRef: text("channel_config_ref"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("admin_user_notification_preferences_user_config_idx").on(
			table.userId,
			table.channelConfigRef,
		),
	],
);

export const commenterNotificationPreferences = sqliteTable(
	"commenter_notification_preferences",
	{
		id: text("id").primaryKey(),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		email: text("email").notNull(),
		emailHash: text("email_hash").notNull(),
		notifyOnReply: integer("notify_on_reply", { mode: "boolean" })
			.notNull()
			.default(false),
		unsubscribedAt: text("unsubscribed_at"),
		source: text("source").notNull(),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("commenter_notification_preferences_site_email_idx").on(
			table.siteId,
			table.emailHash,
		),
		index("commenter_notification_preferences_site_idx").on(table.siteId),
	],
);

export const emailDeliveryReputation = sqliteTable(
	"email_delivery_reputation",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		email: text("email").notNull(),
		emailHash: text("email_hash").notNull(),
		failureScore: integer("failure_score").notNull().default(0),
		lastFailureAt: text("last_failure_at"),
		lastSuccessAt: text("last_success_at"),
		suppressedUntil: text("suppressed_until"),
		suppressedReason: text("suppressed_reason"),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("email_delivery_reputation_site_email_idx").on(
			table.siteId,
			table.emailHash,
		),
		index("email_delivery_reputation_site_idx").on(table.siteId),
	],
);

export const unsubscribeTokens = sqliteTable(
	"unsubscribe_tokens",
	{
		id: text("id").primaryKey(),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		emailHash: text("email_hash").notNull(),
		tokenHash: text("token_hash").notNull(),
		purpose: text("purpose").notNull(),
		expiresAt: text("expires_at"),
		consumedAt: text("consumed_at"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("unsubscribe_tokens_token_hash_idx").on(table.tokenHash),
		index("unsubscribe_tokens_site_email_idx").on(
			table.siteId,
			table.emailHash,
		),
	],
);

export const notificationTemplates = sqliteTable(
	"notification_templates",
	{
		key: text("key").primaryKey(),
		channel: text("channel").notNull(),
		eventType: text("event_type").notNull(),
		format: text("format").notNull(),
		subjectTemplate: text("subject_template"),
		bodyTemplate: text("body_template").notNull(),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedByUserId: integer("updated_by_user_id").references(
			() => adminUsers.id,
		),
	},
	(table) => [
		index("notification_templates_channel_event_idx").on(
			table.channel,
			table.eventType,
		),
	],
);
