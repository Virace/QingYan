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

export const taskRuns = sqliteTable(
	"task_runs",
	{
		id: text("id").primaryKey(),
		queueBackend: text("queue_backend").notNull(),
		queueMessageId: text("queue_message_id"),
		type: text("type").notNull(),
		category: text("category").notNull(),
		status: text("status").notNull(),
		siteId: integer("site_id").references(() => sites.id),
		siteKey: text("site_key"),
		actorType: text("actor_type"),
		actorId: text("actor_id"),
		subjectType: text("subject_type"),
		subjectId: text("subject_id"),
		payloadSummaryJson: text("payload_summary_json").notNull(),
		payloadJson: text("payload_json").notNull(),
		progressJson: text("progress_json"),
		resultJson: text("result_json"),
		errorJson: text("error_json"),
		idempotencyKey: text("idempotency_key"),
		runAfter: text("run_after"),
		attempts: integer("attempts").notNull().default(0),
		maxAttempts: integer("max_attempts").notNull().default(1),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		startedAt: text("started_at"),
		finishedAt: text("finished_at"),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("task_runs_status_run_after_idx").on(table.status, table.runAfter),
		index("task_runs_category_created_idx").on(table.category, table.createdAt),
		index("task_runs_site_idx").on(table.siteId),
		uniqueIndex("task_runs_idempotency_idx").on(table.idempotencyKey),
	],
);

export const notificationDeliveries = sqliteTable(
	"notification_deliveries",
	{
		id: text("id").primaryKey(),
		taskRunId: text("task_run_id")
			.notNull()
			.references(() => taskRuns.id),
		channel: text("channel").notNull(),
		channelConfigRef: text("channel_config_ref"),
		channelConfigNameSnapshot: text("channel_config_name_snapshot"),
		recipientType: text("recipient_type").notNull(),
		recipientUserId: integer("recipient_user_id").references(
			() => adminUsers.id,
		),
		recipientAddressSnapshot: text("recipient_address_snapshot").notNull(),
		recipientIdentityKey: text("recipient_identity_key").notNull(),
		eventFamily: text("event_family").notNull(),
		templateKey: text("template_key").notNull(),
		status: text("status").notNull(),
		providerMessageId: text("provider_message_id"),
		lastErrorJson: text("last_error_json"),
		sentAt: text("sent_at"),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("notification_deliveries_task_run_idx").on(table.taskRunId),
		index("notification_deliveries_recipient_idx").on(
			table.recipientType,
			table.recipientIdentityKey,
		),
		index("notification_deliveries_status_idx").on(table.status),
	],
);
