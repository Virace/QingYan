import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	index,
	integer,
	pgTable,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";
import { jsonText, exactText as text, utcTimestamp } from "./column-types";
import { sites } from "./sites";

export const taskRuns = pgTable(
	"task_runs",
	{
		id: text("id").primaryKey(),
		queueBackend: text("queue_backend").notNull(),
		queueMessageId: text("queue_message_id"),
		scheduledTaskId: text("scheduled_task_id"),
		scheduledTaskNameSnapshot: text("scheduled_task_name_snapshot"),
		type: text("type").notNull(),
		category: text("category").notNull(),
		status: text("status").notNull(),
		siteId: bigint("site_id", { mode: "number" }).references(() => sites.id),
		siteKey: text("site_key"),
		scopeKind: text("scope_kind"),
		trigger: text("trigger"),
		triggerSnapshotJson: jsonText("trigger_snapshot_json"),
		scopeJson: jsonText("scope_json"),
		inputJson: jsonText("input_json"),
		actionConfigSnapshotJson: jsonText("action_config_snapshot_json"),
		actorType: text("actor_type"),
		actorId: text("actor_id"),
		subjectType: text("subject_type"),
		subjectId: text("subject_id"),
		payloadSummaryJson: jsonText("payload_summary_json").notNull(),
		payloadJson: jsonText("payload_json").notNull(),
		progressJson: jsonText("progress_json"),
		resultJson: jsonText("result_json"),
		errorJson: jsonText("error_json"),
		skipReason: text("skip_reason"),
		blockReason: text("block_reason"),
		idempotencyKey: text("idempotency_key"),
		runAfter: utcTimestamp("run_after"),
		attempts: integer("attempts").notNull().default(0),
		maxAttempts: integer("max_attempts").notNull().default(1),
		retryDelaySec: integer("retry_delay_sec").notNull().default(0),
		priority: integer("priority").notNull().default(0),
		concurrencyKey: text("concurrency_key"),
		workerId: text("worker_id"),
		claimToken: uuid("claim_token"),
		lockConflictWithRunId: text("lock_conflict_with_run_id"),
		lockConflictWithTaskName: text("lock_conflict_with_task_name"),
		ownerUserIdSnapshot: bigint("owner_user_id_snapshot", {
			mode: "number",
		}).references(() => adminUsers.id),
		createdByUserId: bigint("created_by_user_id", {
			mode: "number",
		}).references(() => adminUsers.id),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		startedAt: utcTimestamp("started_at"),
		finishedAt: utcTimestamp("finished_at"),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		check("task_runs_attempts_nonnegative", sql`${table.attempts} >= 0`),
		check(
			"task_runs_retry_delay_sec_nonnegative",
			sql`${table.retryDelaySec} >= 0`,
		),
		check(
			"task_runs_status_check",
			sql`${table.status} IN ('queued', 'delayed', 'running', 'retrying', 'succeeded', 'failed', 'skipped', 'blocked', 'suppressed', 'cancelled')`,
		),
		check("task_runs_max_attempts_positive", sql`${table.maxAttempts} > 0`),
		index("task_runs_scheduled_task_created_idx").on(
			table.scheduledTaskId,
			table.createdAt,
		),
		index("task_runs_status_run_after_idx").on(table.status, table.runAfter),
		index("task_runs_type_status_run_after_idx").on(
			table.type,
			table.status,
			table.runAfter,
		),
		index("task_runs_category_created_idx").on(table.category, table.createdAt),
		index("task_runs_comment_subject_created_idx").on(
			table.category,
			table.subjectType,
			table.subjectId,
			table.createdAt,
		),
		index("task_runs_site_idx").on(table.siteId),
		index("task_runs_site_created_idx").on(table.siteId, table.createdAt),
		index("task_runs_concurrency_status_idx").on(
			table.concurrencyKey,
			table.status,
		),
		uniqueIndex("task_runs_idempotency_idx").on(table.idempotencyKey),
	],
);

export const notificationDeliveries = pgTable(
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
		recipientUserId: bigint("recipient_user_id", { mode: "number" }).references(
			() => adminUsers.id,
		),
		recipientAddressSnapshot: text("recipient_address_snapshot").notNull(),
		recipientIdentityKey: text("recipient_identity_key").notNull(),
		eventFamily: text("event_family").notNull(),
		templateKey: text("template_key").notNull(),
		status: text("status").notNull(),
		providerMessageId: text("provider_message_id"),
		lastErrorJson: jsonText("last_error_json"),
		sentAt: utcTimestamp("sent_at"),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
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
