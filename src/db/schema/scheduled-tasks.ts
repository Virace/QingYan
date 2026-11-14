import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	index,
	integer,
	pgTable,
} from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";
import { jsonText, exactText as text, utcTimestamp } from "./column-types";
import { sites } from "./sites";

export const scheduledTasks = pgTable(
	"scheduled_tasks",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		description: text("description"),
		type: text("type").notNull(),
		siteId: bigint("site_id", { mode: "number" }).references(() => sites.id),
		scopeKind: text("scope_kind").notNull(),
		scopeJson: jsonText("scope_json").notNull(),
		enabled: boolean("enabled").notNull().default(false),
		disabledReason: text("disabled_reason"),
		scheduleKind: text("schedule_kind").notNull(),
		schedulePreset: text("schedule_preset"),
		cronExpression: text("cron_expression"),
		timezone: text("timezone"),
		payloadJson: jsonText("payload_json").notNull(),
		payloadSchemaVersion: integer("payload_schema_version")
			.notNull()
			.default(1),
		systemKey: text("system_key"),
		protectionJson: jsonText("protection_json"),
		policyJson: jsonText("policy_json").notNull(),
		triggerJson: jsonText("trigger_json").notNull(),
		triggerSchemaVersion: integer("trigger_schema_version")
			.notNull()
			.default(1),
		nextRunAt: utcTimestamp("next_run_at"),
		claimWorkerId: text("claim_worker_id"),
		claimExpiresAt: utcTimestamp("claim_expires_at"),
		lastRunAt: utcTimestamp("last_run_at"),
		lastRunId: text("last_run_id"),
		lastStatus: text("last_status"),
		retentionCount: bigint("retention_count", { mode: "number" })
			.notNull()
			.default(5),
		ownerUserId: bigint("owner_user_id", { mode: "number" })
			.notNull()
			.references(() => adminUsers.id),
		createdByUserId: bigint("created_by_user_id", {
			mode: "number",
		}).references(() => adminUsers.id),
		updatedByUserId: bigint("updated_by_user_id", {
			mode: "number",
		}).references(() => adminUsers.id),
		transferredByUserId: bigint("transferred_by_user_id", {
			mode: "number",
		}).references(() => adminUsers.id),
		transferredAt: utcTimestamp("transferred_at"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		deletedAt: utcTimestamp("deleted_at"),
	},
	(table) => [
		check(
			"scheduled_tasks_retention_count_nonnegative",
			sql`${table.retentionCount} >= 0`,
		),
		index("scheduled_tasks_enabled_next_run_idx").on(
			table.enabled,
			table.nextRunAt,
		),
		index("scheduled_tasks_claim_expires_idx").on(table.claimExpiresAt),
		index("scheduled_tasks_system_key_idx").on(table.systemKey),
		index("scheduled_tasks_site_type_idx").on(table.siteId, table.type),
		index("scheduled_tasks_owner_idx").on(table.ownerUserId),
		index("scheduled_tasks_deleted_idx").on(table.deletedAt),
	],
);

export const scheduledTaskDeletedSnapshots = pgTable(
	"scheduled_task_deleted_snapshots",
	{
		id: text("id").primaryKey(),
		scheduledTaskId: text("scheduled_task_id").notNull(),
		snapshotJson: jsonText("snapshot_json").notNull(),
		deletedByUserId: bigint("deleted_by_user_id", {
			mode: "number",
		}).references(() => adminUsers.id),
		deletedAt: utcTimestamp("deleted_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		deleteReason: text("delete_reason"),
		lastRunId: text("last_run_id"),
		lastStatus: text("last_status"),
	},
	(table) => [
		index("scheduled_task_deleted_snapshots_task_idx").on(
			table.scheduledTaskId,
		),
		index("scheduled_task_deleted_snapshots_deleted_idx").on(table.deletedAt),
	],
);
