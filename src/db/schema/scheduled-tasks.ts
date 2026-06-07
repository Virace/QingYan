import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { adminUsers } from "./admin-users";
import { sites } from "./sites";

export const scheduledTasks = sqliteTable(
	"scheduled_tasks",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		description: text("description"),
		type: text("type").notNull(),
		siteId: integer("site_id").references(() => sites.id),
		scopeKind: text("scope_kind").notNull(),
		scopeJson: text("scope_json").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
		disabledReason: text("disabled_reason"),
		scheduleKind: text("schedule_kind").notNull(),
		schedulePreset: text("schedule_preset"),
		cronExpression: text("cron_expression"),
		timezone: text("timezone"),
		payloadJson: text("payload_json").notNull(),
		payloadSchemaVersion: integer("payload_schema_version")
			.notNull()
			.default(1),
		systemKey: text("system_key"),
		protectionJson: text("protection_json"),
		policyJson: text("policy_json").notNull(),
		triggerJson: text("trigger_json").notNull(),
		triggerSchemaVersion: integer("trigger_schema_version")
			.notNull()
			.default(1),
		nextRunAt: text("next_run_at"),
		claimWorkerId: text("claim_worker_id"),
		claimExpiresAt: text("claim_expires_at"),
		lastRunAt: text("last_run_at"),
		lastRunId: text("last_run_id"),
		lastStatus: text("last_status"),
		retentionCount: integer("retention_count").notNull().default(5),
		ownerUserId: integer("owner_user_id")
			.notNull()
			.references(() => adminUsers.id),
		createdByUserId: integer("created_by_user_id").references(
			() => adminUsers.id,
		),
		updatedByUserId: integer("updated_by_user_id").references(
			() => adminUsers.id,
		),
		transferredByUserId: integer("transferred_by_user_id").references(
			() => adminUsers.id,
		),
		transferredAt: text("transferred_at"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		deletedAt: text("deleted_at"),
	},
	(table) => [
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

export const scheduledTaskDeletedSnapshots = sqliteTable(
	"scheduled_task_deleted_snapshots",
	{
		id: text("id").primaryKey(),
		scheduledTaskId: text("scheduled_task_id").notNull(),
		snapshotJson: text("snapshot_json").notNull(),
		deletedByUserId: integer("deleted_by_user_id").references(
			() => adminUsers.id,
		),
		deletedAt: text("deleted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
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
