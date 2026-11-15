import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";
import { ARCHIVED_TABLES, INLINE_METADATA } from "./source";
import { SOURCE_COLUMNS } from "./source-columns";

export const TARGET_TABLES = new Map<string, PgTable>(
	Object.values(schema)
		.filter((value) => is(value, Table))
		.map((table) => [getTableName(table), table]),
);
export function targetColumns(table: string) {
	const model = TARGET_TABLES.get(table);
	if (!model) throw new Error(`CONVERSION_UNKNOWN_TARGET:${table}`);
	return Object.values(getTableColumns(model));
}
export function primaryKeys(table: string): string[] {
	const model = TARGET_TABLES.get(table);
	if (!model) throw new Error(`CONVERSION_UNKNOWN_TARGET:${table}`);
	const config = getTableConfig(model);
	return config.primaryKeys.length
		? config.primaryKeys[0].columns.map((column) => column.name)
		: config.columns
				.filter((column) => column.primary)
				.map((column) => column.name);
}

export const IMPORT_ORDER = [
	"sites",
	"admin_groups",
	"admin_users",
	"admin_bootstrap_state",
	"admin_user_groups",
	"admin_user_site_access",
	"admin_profile_verification_tokens",
	"admin_sessions",
	"system_settings",
	"site_settings",
	"allowlist_rules",
	"blacklist_rules",
	"audit_logs",
	"site_page_registry",
	"page_threads",
	"pending_page_candidates",
	"pending_page_view_sessions",
	"visitors",
	"comments",
	"comment_request_metadata",
	"visitor_request_metadata",
	"comment_moderation",
	"vote_records",
	"page_feedback_records",
	"page_view_sessions",
	"captcha_sessions",
	"delayed_deletions",
	"notification_channel_configs",
	"site_notification_event_recipients",
	"site_notification_event_channels",
	"admin_user_notification_preferences",
	"commenter_notification_preferences",
	"email_delivery_reputation",
	"unsubscribe_tokens",
	"notification_templates",
	"scheduled_tasks",
	"scheduled_task_deleted_snapshots",
	"task_runs",
	"notification_deliveries",
	"task_event_logs",
	"task_metric_rollups",
	"ip_region_database_state",
	"__qingyan_upgrades",
];

export const TRANSFORMED_FIELDS: Record<string, readonly string[]> = {
	admin_users: ["username", "password_hash", "password_rotated_at"],
	admin_bootstrap_state: ["username", "password_hash", "password_rotated_at"],
	admin_user_notification_preferences: ["channel_config_ref"],
	comment_request_metadata: Object.values(INLINE_METADATA),
	visitor_request_metadata: [
		"id",
		"first_seen_at",
		"last_seen_at",
		"seen_count",
		"updated_at",
	],
	scheduled_tasks: [
		"payload_json",
		"policy_json",
		"trigger_json",
		"claim_worker_id",
		"claim_expires_at",
	],
	scheduled_task_deleted_snapshots: ["snapshot_json"],
	task_runs: [
		"payload_json",
		"action_config_snapshot_json",
		"input_json",
		"trigger_snapshot_json",
		"status",
		"worker_id",
		"run_after",
	],
	task_event_logs: ["sequence"],
	task_metric_rollups: [
		"id",
		"site_key",
		"dimension_json",
		"value",
		"sample_count",
		"created_at",
		"updated_at",
	],
};

/** 每个源字段均登记去向；生成列单独列出，源结构增加字段时预检直接拒绝。 */
export function fieldManifest() {
	return Object.entries(SOURCE_COLUMNS).map(([table, fields]) => {
		const target = TARGET_TABLES.has(table)
			? targetColumns(table).map((column) => column.name)
			: [];
		return {
			table,
			disposition: ARCHIVED_TABLES.has(table)
				? "archive"
				: "active-and-full-archive",
			fields: fields.map((field) => ({
				field,
				destination: ARCHIVED_TABLES.has(table)
					? "source.sqlite"
					: table === "admin_bootstrap_state" && field === "password_rotated_at"
						? "source.sqlite (historical bootstrap rotation); admin_users retains its own account rotation timestamp"
						: table === "comments" && field in INLINE_METADATA
							? `comment_request_metadata.${INLINE_METADATA[field]} (fallback); original in source.sqlite`
							: table === "admin_bootstrap_state" &&
									["username", "password_hash"].includes(field)
								? `admin_users.${field}; original in source.sqlite`
								: `${table}.${field}`,
				mode:
					ARCHIVED_TABLES.has(table) ||
					(table === "admin_bootstrap_state" && field === "password_rotated_at")
						? "archive"
						: !target.includes(field) ||
								TRANSFORMED_FIELDS[table]?.includes(field)
							? "transform-or-merge"
							: "direct",
			})),
			generatedFields: target.filter((column) => !fields.includes(column)),
			rowExceptions: [
				"scheduled_tasks",
				"scheduled_task_deleted_snapshots",
				"task_runs",
				"task_event_logs",
				"notification_deliveries",
			].includes(table)
				? "retired backup records and dependent history archived; see rowMappings"
				: null,
		};
	});
}
