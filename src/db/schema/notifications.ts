import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	index,
	integer,
	pgTable,
	primaryKey,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";
import { jsonText, exactText as text, utcTimestamp } from "./column-types";
import { sites } from "./sites";

export const notificationChannelConfigs = pgTable(
	"notification_channel_configs",
	{
		id: text("id").primaryKey(),
		type: text("type").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		enabled: boolean("enabled").notNull().default(true),
		configJson: jsonText("config_json").notNull(),
		secretConfigJson: jsonText("secret_config_json").notNull().default("{}"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("notification_channel_configs_type_idx").on(table.type),
		index("notification_channel_configs_enabled_idx").on(table.enabled),
	],
);

export const siteNotificationEventRecipients = pgTable(
	"site_notification_event_recipients",
	{
		id: text("id").primaryKey(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		eventType: text("event_type").notNull(),
		userId: bigint("user_id", { mode: "number" })
			.notNull()
			.references(() => adminUsers.id),
		includeCommentContent: text("include_comment_content")
			.notNull()
			.default("summary"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("site_notification_event_recipients_unique_idx").on(
			table.siteId,
			table.eventType,
			table.userId,
		),
		index("site_notification_event_recipients_site_idx").on(table.siteId),
		index("site_notification_event_recipients_event_idx").on(table.eventType),
		index("site_notification_event_recipients_user_idx").on(table.userId),
	],
);

export const siteNotificationEventChannels = pgTable(
	"site_notification_event_channels",
	{
		id: text("id").primaryKey(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		eventType: text("event_type").notNull(),
		channelConfigId: text("channel_config_id")
			.notNull()
			.references(() => notificationChannelConfigs.id),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("site_notification_event_channels_unique_idx").on(
			table.siteId,
			table.eventType,
			table.channelConfigId,
		),
		index("site_notification_event_channels_site_idx").on(table.siteId),
		index("site_notification_event_channels_event_idx").on(table.eventType),
		index("site_notification_event_channels_config_idx").on(
			table.channelConfigId,
		),
	],
);

export const adminUserNotificationPreferences = pgTable(
	"admin_user_notification_preferences",
	{
		userId: bigint("user_id", { mode: "number" })
			.notNull()
			.references(() => adminUsers.id),
		channel: text("channel").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		digestMode: text("digest_mode").notNull().default("off"),
		digestIntervalMinutes: integer("digest_interval_minutes"),
		digestTimesJson: jsonText("digest_times_json"),
		pausedUntil: utcTimestamp("paused_until"),
		channelConfigRef: text("channel_config_ref").notNull(),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		primaryKey({
			name: "admin_user_notification_preferences_user_config_pk",
			columns: [table.userId, table.channelConfigRef],
		}),
		uniqueIndex("admin_user_notification_preferences_user_config_idx").on(
			table.userId,
			table.channelConfigRef,
		),
	],
);

export const commenterNotificationPreferences = pgTable(
	"commenter_notification_preferences",
	{
		id: text("id").primaryKey(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		email: text("email").notNull(),
		emailHash: text("email_hash").notNull(),
		notifyOnReply: boolean("notify_on_reply").notNull().default(false),
		unsubscribedAt: utcTimestamp("unsubscribed_at"),
		source: text("source").notNull(),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("commenter_notification_preferences_site_email_idx").on(
			table.siteId,
			table.emailHash,
		),
		index("commenter_notification_preferences_site_idx").on(table.siteId),
	],
);

export const emailDeliveryReputation = pgTable(
	"email_delivery_reputation",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		email: text("email").notNull(),
		emailHash: text("email_hash").notNull(),
		failureScore: integer("failure_score").notNull().default(0),
		lastFailureAt: utcTimestamp("last_failure_at"),
		lastSuccessAt: utcTimestamp("last_success_at"),
		suppressedUntil: utcTimestamp("suppressed_until"),
		suppressedReason: text("suppressed_reason"),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("email_delivery_reputation_site_email_idx").on(
			table.siteId,
			table.emailHash,
		),
		index("email_delivery_reputation_site_idx").on(table.siteId),
	],
);

export const unsubscribeTokens = pgTable(
	"unsubscribe_tokens",
	{
		id: text("id").primaryKey(),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		emailHash: text("email_hash").notNull(),
		tokenHash: text("token_hash").notNull(),
		purpose: text("purpose").notNull(),
		expiresAt: utcTimestamp("expires_at"),
		consumedAt: utcTimestamp("consumed_at"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex("unsubscribe_tokens_token_hash_idx").on(table.tokenHash),
		index("unsubscribe_tokens_site_email_idx").on(
			table.siteId,
			table.emailHash,
		),
	],
);

export const notificationTemplates = pgTable(
	"notification_templates",
	{
		key: text("key").primaryKey(),
		channel: text("channel").notNull(),
		eventType: text("event_type").notNull(),
		format: text("format").notNull(),
		subjectTemplate: text("subject_template"),
		bodyTemplate: text("body_template").notNull(),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedByUserId: bigint("updated_by_user_id", {
			mode: "number",
		}).references(() => adminUsers.id),
	},
	(table) => [
		index("notification_templates_channel_event_idx").on(
			table.channel,
			table.eventType,
		),
	],
);
