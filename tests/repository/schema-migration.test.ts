import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { applyDatabaseMigrations } from "../../src/db/migrations";
import { applyInitialMigration } from "../support/test-fixtures";

function createMigratedDatabase() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-schema-"));
	const databaseFile = path.join(directory, "schema.db");

	applyInitialMigration(databaseFile);

	const sqlite = new Database(databaseFile);

	return {
		sqlite,
		cleanup() {
			sqlite.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

describe("initial migration", () => {
	it("creates the phase-1 core tables", () => {
		const fixture = createMigratedDatabase();

		try {
			const tables = fixture.sqlite
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all() as Array<{ name: string }>;

			expect(tables.map((table) => table.name)).toEqual(
				expect.arrayContaining([
					"sites",
					"page_threads",
					"visitors",
					"visitor_request_metadata",
					"page_view_sessions",
					"comments",
					"vote_records",
					"page_feedback_records",
					"captcha_sessions",
					"blacklist_rules",
					"allowlist_rules",
					"admin_sessions",
					"admin_bootstrap_state",
					"site_settings",
					"system_settings",
					"__qingyan_upgrades",
					"audit_logs",
					"import_batches",
					"import_records",
					"site_page_registry",
					"pending_page_candidates",
					"pending_page_view_sessions",
					"admin_profile_verification_tokens",
					"delayed_deletions",
				]),
			);
		} finally {
			fixture.cleanup();
		}
	});

	it("keeps site settings unique per site and avoids provider-specific settings", () => {
		const fixture = createMigratedDatabase();
		const combinedMigrationSql = readdirSync(
			path.resolve(process.cwd(), "drizzle"),
		)
			.filter((fileName) => fileName.endsWith(".sql"))
			.sort()
			.map((fileName) =>
				readFileSync(path.resolve(process.cwd(), "drizzle", fileName), "utf-8"),
			)
			.join("\n");

		try {
			fixture.sqlite
				.prepare(
					"INSERT INTO sites (site_key, name, allowed_origins_json) VALUES (?, ?, ?)",
				)
				.run("fangyuan", "FangYuan", "[]");
			fixture.sqlite
				.prepare("INSERT INTO site_settings (site_id) VALUES (?)")
				.run(1);

			expect(() =>
				fixture.sqlite
					.prepare("INSERT INTO site_settings (site_id) VALUES (?)")
					.run(1),
			).toThrow();
			expect(combinedMigrationSql).not.toContain("runtime_provider");
			expect(combinedMigrationSql).not.toContain("runtime_settings");
			expect(combinedMigrationSql).not.toContain("artalk_");
			expect(combinedMigrationSql).not.toContain("wp_");
			expect(combinedMigrationSql).toContain("`captcha_mode` text");
			expect(combinedMigrationSql).toContain(
				"`captcha_threshold_window_sec` integer",
			);
			expect(combinedMigrationSql).toContain(
				"`captcha_threshold_max_actions` integer",
			);
			expect(combinedMigrationSql).toContain("`abuse_guard_enabled` integer");
			expect(combinedMigrationSql).toContain(
				"`abuse_guard_window_sec` integer",
			);
			expect(combinedMigrationSql).toContain(
				"`abuse_guard_max_write_actions` integer",
			);
			expect(combinedMigrationSql).toContain(
				"`auto_blacklist_enabled` integer",
			);
			expect(combinedMigrationSql).toContain("`auto_blacklist_scope` text");
			expect(combinedMigrationSql).toContain(
				"`auto_blacklist_ttl_sec` integer",
			);
			expect(combinedMigrationSql).toContain(
				"`comment_input_limits_json` text",
			);
			expect(combinedMigrationSql).toContain("`comment_metadata_json` text");
			expect(combinedMigrationSql).toContain("`engagement_json` text");
			expect(combinedMigrationSql).toContain("`page_registry_json` text");
			expect(combinedMigrationSql).toContain("`staff_display_json` text");
			expect(combinedMigrationSql).toContain("CREATE TABLE `system_settings`");
			expect(combinedMigrationSql).toContain(
				"CREATE UNIQUE INDEX `system_settings_category_key_idx`",
			);
			expect(combinedMigrationSql).toContain("`triggered_by` text NOT NULL");
			expect(combinedMigrationSql).toContain("`scope` text");
			expect(combinedMigrationSql).toContain("`match_mode` text");
			expect(combinedMigrationSql).toContain(
				'`comment_require_json` text DEFAULT \'["nickname","email"]\' NOT NULL',
			);
		} finally {
			fixture.cleanup();
		}
	});

	it("does not create legacy page source tables in the current schema", () => {
		const fixture = createMigratedDatabase();

		try {
			const legacySourceTable = fixture.sqlite
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
				)
				.get("site_page_registry_sources");
			const legacySourcePageTable = fixture.sqlite
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
				)
				.get("site_page_registry_source_pages");

			expect(legacySourceTable).toBeUndefined();
			expect(legacySourcePageTable).toBeUndefined();
		} finally {
			fixture.cleanup();
		}
	});

	it("applies captcha and abuse guard schema changes to the migrated database", () => {
		const fixture = createMigratedDatabase();

		try {
			const commentsColumns = fixture.sqlite
				.prepare("PRAGMA table_info(comments)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const commentForeignKeys = fixture.sqlite
				.prepare("PRAGMA foreign_key_list(comments)")
				.all() as Array<{ from: string; table: string; to: string }>;
			const commentRequestMetadataColumns = fixture.sqlite
				.prepare("PRAGMA table_info(comment_request_metadata)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const visitorRequestMetadataColumns = fixture.sqlite
				.prepare("PRAGMA table_info(visitor_request_metadata)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const visitorRequestMetadataIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(visitor_request_metadata)")
				.all() as Array<{ name: string; unique: number }>;
			const siteSettingsColumns = fixture.sqlite
				.prepare("PRAGMA table_info(site_settings)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const systemSettingsColumns = fixture.sqlite
				.prepare("PRAGMA table_info(system_settings)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const captchaSessionColumns = fixture.sqlite
				.prepare("PRAGMA table_info(captcha_sessions)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const blacklistRuleColumns = fixture.sqlite
				.prepare("PRAGMA table_info(blacklist_rules)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const allowlistRuleColumns = fixture.sqlite
				.prepare("PRAGMA table_info(allowlist_rules)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const allowlistRuleIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(allowlist_rules)")
				.all() as Array<{ name: string; unique: number }>;
			const adminBootstrapColumns = fixture.sqlite
				.prepare("PRAGMA table_info(admin_bootstrap_state)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const upgradeLedgerColumns = fixture.sqlite
				.prepare("PRAGMA table_info(__qingyan_upgrades)")
				.all() as Array<{
				name: string;
				notnull: number;
				pk: number;
				type: string;
			}>;
			const pageRegistryColumns = fixture.sqlite
				.prepare("PRAGMA table_info(site_page_registry)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const pendingCandidateColumns = fixture.sqlite
				.prepare("PRAGMA table_info(pending_page_candidates)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const pendingViewSessionColumns = fixture.sqlite
				.prepare("PRAGMA table_info(pending_page_view_sessions)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const emailVerificationColumns = fixture.sqlite
				.prepare("PRAGMA table_info(admin_profile_verification_tokens)")
				.all() as Array<{ name: string }>;
			const emailVerificationIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(admin_profile_verification_tokens)")
				.all() as Array<{ name: string; unique: number }>;
			const delayedDeletionColumns = fixture.sqlite
				.prepare("PRAGMA table_info(delayed_deletions)")
				.all() as Array<{ name: string }>;
			const delayedDeletionIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(delayed_deletions)")
				.all() as Array<{ name: string; unique: number }>;
			const siteNotificationRecipientColumns = fixture.sqlite
				.prepare("PRAGMA table_info(site_notification_recipients)")
				.all() as Array<{ name: string }>;
			const siteNotificationRecipientIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(site_notification_recipients)")
				.all() as Array<{ name: string; unique: number }>;
			const notificationChannelConfigColumns = fixture.sqlite
				.prepare("PRAGMA table_info(notification_channel_configs)")
				.all() as Array<{ name: string }>;
			const notificationChannelConfigIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(notification_channel_configs)")
				.all() as Array<{ name: string; unique: number }>;
			const siteNotificationRecipientRouteColumns = fixture.sqlite
				.prepare("PRAGMA table_info(site_notification_recipient_routes)")
				.all() as Array<{ name: string }>;
			const siteNotificationRecipientRouteIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(site_notification_recipient_routes)")
				.all() as Array<{ name: string; unique: number }>;
			const adminNotificationPreferenceColumns = fixture.sqlite
				.prepare("PRAGMA table_info(admin_user_notification_preferences)")
				.all() as Array<{ name: string }>;
			const adminNotificationPreferenceIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(admin_user_notification_preferences)")
				.all() as Array<{ name: string; unique: number }>;
			const scheduledTaskColumns = fixture.sqlite
				.prepare("PRAGMA table_info(scheduled_tasks)")
				.all() as Array<{
				name: string;
				notnull: number;
				dflt_value: string | null;
			}>;
			const scheduledTaskIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(scheduled_tasks)")
				.all() as Array<{ name: string; unique: number }>;
			const scheduledTaskForeignKeys = fixture.sqlite
				.prepare("PRAGMA foreign_key_list(scheduled_tasks)")
				.all() as Array<{ from: string; table: string; to: string }>;
			const scheduledTaskDeletedSnapshotColumns = fixture.sqlite
				.prepare("PRAGMA table_info(scheduled_task_deleted_snapshots)")
				.all() as Array<{ name: string; notnull: number }>;
			const scheduledTaskDeletedSnapshotIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(scheduled_task_deleted_snapshots)")
				.all() as Array<{ name: string; unique: number }>;
			const taskRunColumns = fixture.sqlite
				.prepare("PRAGMA table_info(task_runs)")
				.all() as Array<{
				name: string;
				notnull: number;
				dflt_value: string | null;
			}>;
			const taskRunIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(task_runs)")
				.all() as Array<{ name: string; unique: number }>;
			const taskRunForeignKeys = fixture.sqlite
				.prepare("PRAGMA foreign_key_list(task_runs)")
				.all() as Array<{ from: string; table: string; to: string }>;
			const taskEventLogColumns = fixture.sqlite
				.prepare("PRAGMA table_info(task_event_logs)")
				.all() as Array<{ name: string; notnull: number }>;
			const taskEventLogIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(task_event_logs)")
				.all() as Array<{ name: string; unique: number }>;
			const taskEventLogForeignKeys = fixture.sqlite
				.prepare("PRAGMA foreign_key_list(task_event_logs)")
				.all() as Array<{ from: string; table: string; to: string }>;
			const taskMetricRollupColumns = fixture.sqlite
				.prepare("PRAGMA table_info(task_metric_rollups)")
				.all() as Array<{
				name: string;
				notnull: number;
				type: string;
			}>;
			const taskMetricRollupIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(task_metric_rollups)")
				.all() as Array<{ name: string; unique: number }>;
			const taskMetricRollupForeignKeys = fixture.sqlite
				.prepare("PRAGMA foreign_key_list(task_metric_rollups)")
				.all() as Array<{ from: string; table: string; to: string }>;
			const deliveryColumns = fixture.sqlite
				.prepare("PRAGMA table_info(notification_deliveries)")
				.all() as Array<{ name: string; notnull: number }>;
			const deliveryIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(notification_deliveries)")
				.all() as Array<{ name: string; unique: number }>;
			const deliveryForeignKeys = fixture.sqlite
				.prepare("PRAGMA foreign_key_list(notification_deliveries)")
				.all() as Array<{ from: string; table: string; to: string }>;
			const notificationTemplateColumns = fixture.sqlite
				.prepare("PRAGMA table_info(notification_templates)")
				.all() as Array<{ name: string }>;
			const notificationTemplateIndexes = fixture.sqlite
				.prepare("PRAGMA index_list(notification_templates)")
				.all() as Array<{ name: string }>;

			expect(commentsColumns.map((column) => column.name)).not.toEqual(
				expect.arrayContaining([
					"author_ip",
					"author_user_agent",
					"author_ip_country",
					"author_device_browser",
				]),
			);
			expect(commentsColumns.map((column) => column.name)).toContain(
				"author_user_id",
			);
			expect(commentForeignKeys).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						from: "author_user_id",
						table: "admin_users",
						to: "id",
					}),
				]),
			);
			expect(
				commentRequestMetadataColumns.map((column) => column.name),
			).toEqual(
				expect.arrayContaining([
					"comment_id",
					"author_ip",
					"author_user_agent",
					"ip_country",
					"ip_region",
					"ip_city",
					"ip_isp",
					"ip_location_raw",
					"ip_location_source",
					"ip_location_db_hash",
					"ip_location_updated_at",
					"ip_location_error",
					"device_browser",
					"device_browser_version",
					"device_os",
					"device_os_version",
					"device_type",
					"device_icon",
					"device_source",
					"device_parser_version",
					"device_updated_at",
					"device_error",
					"created_at",
					"updated_at",
				]),
			);
			expect(
				visitorRequestMetadataColumns.map((column) => column.name),
			).toEqual([
				"id",
				"site_id",
				"visitor_id",
				"ip",
				"ip_hash",
				"user_agent",
				"user_agent_hash",
				"ip_country",
				"ip_region",
				"ip_city",
				"ip_isp",
				"ip_location_raw",
				"ip_location_source",
				"ip_location_db_hash",
				"ip_location_updated_at",
				"ip_location_error",
				"device_browser",
				"device_browser_version",
				"device_os",
				"device_os_version",
				"device_type",
				"device_icon",
				"device_source",
				"device_parser_version",
				"device_updated_at",
				"device_error",
				"first_seen_at",
				"last_seen_at",
				"seen_count",
				"last_seen_page_key",
				"last_seen_page_url",
				"created_at",
				"updated_at",
			]);
			expect(visitorRequestMetadataIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "visitor_request_metadata_identity_idx",
						unique: 1,
					}),
					expect.objectContaining({
						name: "visitor_request_metadata_visitor_id_idx",
					}),
					expect.objectContaining({
						name: "visitor_request_metadata_site_id_idx",
					}),
					expect.objectContaining({
						name: "visitor_request_metadata_last_seen_at_idx",
					}),
				]),
			);
			expect(siteSettingsColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"comment_require_json",
					"captcha_mode",
					"captcha_threshold_window_sec",
					"captcha_threshold_max_actions",
					"abuse_guard_enabled",
					"abuse_guard_window_sec",
					"abuse_guard_max_write_actions",
					"auto_blacklist_enabled",
					"auto_blacklist_scope",
					"auto_blacklist_ttl_sec",
					"comment_input_limits_json",
					"comment_metadata_json",
					"engagement_json",
					"page_registry_json",
					"staff_display_json",
					"commenter_reply_email_enabled",
					"backend_notifications_enabled",
				]),
			);
			expect(
				siteSettingsColumns.find(
					(column) => column.name === "comment_require_json",
				)?.dflt_value,
			).toBe('\'["nickname","email"]\'');
			expect(
				siteSettingsColumns.find((column) => column.name === "captcha_mode")
					?.dflt_value,
			).toBe("'threshold'");
			expect(systemSettingsColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining(["category", "key", "value_json", "updated_at"]),
			);
			expect(captchaSessionColumns.map((column) => column.name)).toContain(
				"triggered_by",
			);
			expect(captchaSessionColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining(["provider_kind", "provider_state_json"]),
			);
			expect(captchaSessionColumns.map((column) => column.name)).not.toContain(
				"action",
			);
			expect(blacklistRuleColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining(["scope", "match_mode"]),
			);
			expect(allowlistRuleColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"site_id",
					"target_type",
					"match_mode",
					"target_value",
					"scope",
					"reason",
					"expires_at",
					"created_by_user_id",
					"created_at",
					"updated_at",
					"deleted_at",
				]),
			);
			expect(allowlistRuleIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "allowlist_rules_site_target_idx",
					}),
					expect.objectContaining({ name: "allowlist_rules_target_idx" }),
					expect.objectContaining({
						name: "allowlist_rules_expires_at_idx",
					}),
				]),
			);
			expect(adminBootstrapColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"id",
					"console_path",
					"username",
					"password_hash",
					"generated_at",
					"password_rotated_at",
				]),
			);
			expect(
				blacklistRuleColumns.find((column) => column.name === "scope")
					?.dflt_value,
			).toBe("'post'");
			expect(
				allowlistRuleColumns.find((column) => column.name === "scope")
					?.dflt_value,
			).toBe("'all'");
			expect(upgradeLedgerColumns).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "name",
						pk: 1,
						type: "TEXT",
					}),
					expect.objectContaining({ name: "from_version", type: "TEXT" }),
					expect.objectContaining({ name: "to_version", type: "TEXT" }),
					expect.objectContaining({
						name: "applied_at",
						notnull: 1,
						type: "TEXT",
					}),
					expect.objectContaining({
						name: "summary_json",
						notnull: 1,
						type: "TEXT",
					}),
				]),
			);
			expect(pageRegistryColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"id",
					"site_id",
					"page_key",
					"page_url",
					"title",
					"status",
					"title_refresh_attempted_at",
					"title_refreshed_at",
					"title_refresh_status_code",
					"title_refresh_error",
					"first_seen_at",
					"last_seen_at",
					"trashed_at",
					"deleted_at",
					"created_at",
					"updated_at",
				]),
			);
			expect(pendingCandidateColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"id",
					"site_key",
					"page_key",
					"page_url",
					"first_seen_at",
					"last_seen_at",
					"hit_count",
					"status",
					"last_reject_reason",
					"created_at",
					"updated_at",
				]),
			);
			expect(pendingViewSessionColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"id",
					"site_key",
					"page_key",
					"fingerprint",
					"first_seen_at",
					"last_seen_at",
					"hit_count",
					"created_at",
					"updated_at",
				]),
			);
			expect(emailVerificationColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"id",
					"purpose",
					"user_id",
					"token_hash",
					"new_email",
					"pending_password_hash",
					"expires_at",
					"consumed_at",
					"created_at",
				]),
			);
			expect(emailVerificationIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "admin_profile_verification_tokens_user_id_idx",
					}),
					expect.objectContaining({
						name: "admin_profile_verification_tokens_token_hash_idx",
						unique: 1,
					}),
				]),
			);
			expect(delayedDeletionColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"id",
					"resource_type",
					"resource_id",
					"site_id",
					"requested_by_user_id",
					"requested_at",
					"hard_delete_after",
					"restored_by_user_id",
					"restored_at",
					"hard_deleted_at",
					"status",
					"metadata_json",
					"created_at",
					"updated_at",
				]),
			);
			expect(delayedDeletionIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "delayed_deletions_status_due_idx",
					}),
					expect.objectContaining({
						name: "delayed_deletions_site_id_idx",
					}),
					expect.objectContaining({
						name: "delayed_deletions_resource_idx",
					}),
				]),
			);
			expect(
				siteNotificationRecipientColumns.map((column) => column.name),
			).toEqual(
				expect.arrayContaining([
					"id",
					"site_id",
					"user_id",
					"include_comment_content",
					"rate_limit_profile",
					"enabled",
					"created_at",
					"updated_at",
				]),
			);
			expect(siteNotificationRecipientIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "site_notification_recipients_site_user_idx",
						unique: 1,
					}),
					expect.objectContaining({
						name: "site_notification_recipients_site_idx",
					}),
				]),
			);
			expect(
				notificationChannelConfigColumns.map((column) => column.name),
			).toEqual(
				expect.arrayContaining([
					"id",
					"type",
					"name",
					"description",
					"enabled",
					"config_json",
					"secret_config_json",
					"created_at",
					"updated_at",
				]),
			);
			expect(notificationChannelConfigIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "notification_channel_configs_type_idx",
					}),
					expect.objectContaining({
						name: "notification_channel_configs_enabled_idx",
					}),
				]),
			);
			expect(
				siteNotificationRecipientRouteColumns.map((column) => column.name),
			).toEqual(
				expect.arrayContaining([
					"id",
					"recipient_id",
					"event_type",
					"channel_config_id",
					"enabled",
					"created_at",
					"updated_at",
				]),
			);
			expect(siteNotificationRecipientRouteIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "site_notification_recipient_routes_recipient_idx",
					}),
					expect.objectContaining({
						name: "site_notification_recipient_routes_config_idx",
					}),
					expect.objectContaining({
						name: "site_notification_recipient_routes_unique_idx",
						unique: 1,
					}),
				]),
			);
			expect(
				adminNotificationPreferenceColumns.map((column) => column.name),
			).toEqual(
				expect.arrayContaining([
					"user_id",
					"channel",
					"enabled",
					"digest_mode",
					"digest_interval_minutes",
					"digest_times_json",
					"paused_until",
					"channel_config_ref",
					"created_at",
					"updated_at",
				]),
			);
			expect(adminNotificationPreferenceIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "admin_user_notification_preferences_user_config_idx",
						unique: 1,
					}),
				]),
			);
			expect(scheduledTaskColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"id",
					"name",
					"description",
					"type",
					"site_id",
					"scope_kind",
					"scope_json",
					"enabled",
					"disabled_reason",
					"schedule_kind",
					"schedule_preset",
					"cron_expression",
					"timezone",
					"payload_json",
					"payload_schema_version",
					"system_key",
					"protection_json",
					"policy_json",
					"trigger_json",
					"trigger_schema_version",
					"next_run_at",
					"claim_worker_id",
					"claim_expires_at",
					"last_run_at",
					"last_run_id",
					"last_status",
					"retention_count",
					"owner_user_id",
					"created_by_user_id",
					"updated_by_user_id",
					"transferred_by_user_id",
					"transferred_at",
					"created_at",
					"updated_at",
					"deleted_at",
				]),
			);
			expect(
				scheduledTaskColumns.find((column) => column.name === "payload_json")
					?.notnull,
			).toBe(1);
			expect(scheduledTaskIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "scheduled_tasks_enabled_next_run_idx",
					}),
					expect.objectContaining({
						name: "scheduled_tasks_claim_expires_idx",
					}),
					expect.objectContaining({
						name: "scheduled_tasks_system_key_idx",
					}),
					expect.objectContaining({
						name: "scheduled_tasks_site_type_idx",
					}),
					expect.objectContaining({ name: "scheduled_tasks_owner_idx" }),
					expect.objectContaining({ name: "scheduled_tasks_deleted_idx" }),
				]),
			);
			expect(scheduledTaskForeignKeys).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						from: "site_id",
						table: "sites",
						to: "id",
					}),
					expect.objectContaining({
						from: "owner_user_id",
						table: "admin_users",
						to: "id",
					}),
				]),
			);
			expect(
				scheduledTaskDeletedSnapshotColumns.map((column) => column.name),
			).toEqual(
				expect.arrayContaining([
					"id",
					"scheduled_task_id",
					"snapshot_json",
					"deleted_by_user_id",
					"deleted_at",
					"delete_reason",
					"last_run_id",
					"last_status",
				]),
			);
			expect(scheduledTaskDeletedSnapshotIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "scheduled_task_deleted_snapshots_task_idx",
					}),
					expect.objectContaining({
						name: "scheduled_task_deleted_snapshots_deleted_idx",
					}),
				]),
			);
			expect(taskRunColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"id",
					"queue_backend",
					"queue_message_id",
					"scheduled_task_id",
					"scheduled_task_name_snapshot",
					"type",
					"category",
					"status",
					"site_id",
					"site_key",
					"scope_kind",
					"trigger",
					"trigger_snapshot_json",
					"scope_json",
					"input_json",
					"action_config_snapshot_json",
					"actor_type",
					"actor_id",
					"subject_type",
					"subject_id",
					"payload_summary_json",
					"payload_json",
					"progress_json",
					"result_json",
					"error_json",
					"skip_reason",
					"block_reason",
					"idempotency_key",
					"run_after",
					"attempts",
					"max_attempts",
					"retry_delay_sec",
					"priority",
					"concurrency_key",
					"worker_id",
					"lock_conflict_with_run_id",
					"lock_conflict_with_task_name",
					"owner_user_id_snapshot",
					"created_by_user_id",
					"created_at",
					"started_at",
					"finished_at",
					"updated_at",
				]),
			);
			expect(
				taskRunColumns.find((column) => column.name === "payload_json")
					?.notnull,
			).toBe(1);
			expect(taskRunIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "task_runs_scheduled_task_created_idx",
					}),
					expect.objectContaining({
						name: "task_runs_status_run_after_idx",
					}),
					expect.objectContaining({
						name: "task_runs_type_status_run_after_idx",
					}),
					expect.objectContaining({
						name: "task_runs_category_created_idx",
					}),
					expect.objectContaining({ name: "task_runs_site_idx" }),
					expect.objectContaining({ name: "task_runs_site_created_idx" }),
					expect.objectContaining({
						name: "task_runs_concurrency_status_idx",
					}),
					expect.objectContaining({
						name: "task_runs_idempotency_idx",
						unique: 1,
					}),
				]),
			);
			expect(taskRunForeignKeys).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						from: "site_id",
						table: "sites",
						to: "id",
					}),
				]),
			);
			expect(taskEventLogColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"id",
					"task_run_id",
					"sequence",
					"stream",
					"event_type",
					"level",
					"message",
					"data_json",
					"visible_to_site_admin",
					"created_at",
				]),
			);
			expect(taskEventLogIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "task_event_logs_run_sequence_idx",
					}),
					expect.objectContaining({
						name: "task_event_logs_run_created_idx",
					}),
					expect.objectContaining({
						name: "task_event_logs_level_created_idx",
					}),
				]),
			);
			expect(taskEventLogForeignKeys).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						from: "task_run_id",
						table: "task_runs",
						to: "id",
					}),
				]),
			);
			expect(taskMetricRollupColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"id",
					"site_id",
					"site_key",
					"metric_key",
					"bucket_start_at",
					"bucket_size_sec",
					"dimension_json",
					"value",
					"sample_count",
					"created_at",
					"updated_at",
				]),
			);
			expect(
				taskMetricRollupColumns.find((column) => column.name === "site_key")
					?.notnull,
			).toBe(1);
			expect(
				taskMetricRollupColumns.find((column) => column.name === "value")?.type,
			).toBe("REAL");
			expect(taskMetricRollupIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "task_metric_rollups_site_metric_bucket_idx",
					}),
					expect.objectContaining({
						name: "task_metric_rollups_metric_bucket_idx",
					}),
					expect.objectContaining({
						name: "task_metric_rollups_unique_bucket_idx",
						unique: 1,
					}),
				]),
			);
			expect(taskMetricRollupForeignKeys).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						from: "site_id",
						table: "sites",
						to: "id",
					}),
				]),
			);
			expect(deliveryColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"id",
					"task_run_id",
					"channel",
					"channel_config_ref",
					"channel_config_name_snapshot",
					"recipient_type",
					"recipient_user_id",
					"recipient_address_snapshot",
					"recipient_identity_key",
					"event_family",
					"template_key",
					"status",
					"provider_message_id",
					"last_error_json",
					"sent_at",
					"updated_at",
				]),
			);
			expect(deliveryIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "notification_deliveries_task_run_idx",
					}),
					expect.objectContaining({
						name: "notification_deliveries_recipient_idx",
					}),
					expect.objectContaining({
						name: "notification_deliveries_status_idx",
					}),
				]),
			);
			expect(deliveryForeignKeys).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						from: "task_run_id",
						table: "task_runs",
						to: "id",
					}),
				]),
			);
			expect(notificationTemplateColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"key",
					"channel",
					"event_type",
					"format",
					"subject_template",
					"body_template",
					"updated_at",
					"updated_by_user_id",
				]),
			);
			expect(notificationTemplateIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "notification_templates_channel_event_idx",
					}),
				]),
			);
		} finally {
			fixture.cleanup();
		}
	});

	it("applies comment request metadata state tables", () => {
		const fixture = createMigratedDatabase();

		try {
			const stateColumns = fixture.sqlite
				.prepare("PRAGMA table_info(ip_region_database_state)")
				.all() as Array<{ name: string }>;
			const updateRunColumns = fixture.sqlite
				.prepare("PRAGMA table_info(ip_region_update_runs)")
				.all() as Array<{ name: string }>;
			const indexes = fixture.sqlite
				.prepare("PRAGMA index_list(ip_region_database_state)")
				.all() as Array<{ name: string; unique: number }>;

			expect(stateColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"id",
					"ip_version",
					"file_path",
					"file_hash",
					"source_url",
					"cache_policy",
					"activated_at",
					"updated_at",
				]),
			);
			expect(updateRunColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"id",
					"ip_version",
					"source_url",
					"status",
					"previous_hash",
					"next_hash",
					"downloaded_at",
					"activated_at",
					"refreshed_comments",
					"error_message",
					"created_at",
					"updated_at",
				]),
			);
			expect(indexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "ip_region_database_state_version_idx",
						unique: 1,
					}),
				]),
			);
		} finally {
			fixture.cleanup();
		}
	});

	it("keeps the released baseline and one next-release migration", () => {
		const migrationFiles = readdirSync(path.resolve(process.cwd(), "drizzle"))
			.filter((fileName) => fileName.endsWith(".sql"))
			.sort();

		expect(migrationFiles).toEqual([
			"0000_initial.sql",
			"0001_notification_reliability.sql",
		]);
	});

	it("upgrades a v0.1.0 database with notification reliability defaults", () => {
		const directory = mkdtempSync(
			path.join(tmpdir(), "qingyan-schema-v0.1.0-upgrade-"),
		);
		const databaseFile = path.join(directory, "schema.db");
		const sqlite = new Database(databaseFile);

		try {
			sqlite.exec(
				readFileSync(
					path.resolve(process.cwd(), "drizzle", "0000_initial.sql"),
					"utf-8",
				),
			);
			sqlite.exec(`
				CREATE TABLE __qingyan_migrations (
					name text PRIMARY KEY NOT NULL,
					applied_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				INSERT INTO __qingyan_migrations (name) VALUES ('0000_initial.sql');
				INSERT INTO sites (site_key, name, allowed_origins_json)
				VALUES ('upgrade-site', 'Upgrade Site', '[]');
				INSERT INTO site_settings (site_id) VALUES (1);
				INSERT INTO page_threads (site_id, page_key, page_title)
				VALUES (1, 'post:existing', 'Existing');
			`);

			applyDatabaseMigrations(sqlite);

			const siteSettingsColumns = sqlite
				.prepare("PRAGMA table_info(site_settings)")
				.all() as Array<{
				name: string;
				notnull: number;
				dflt_value: string | null;
			}>;
			const pageThreadColumns = sqlite
				.prepare("PRAGMA table_info(page_threads)")
				.all() as Array<{
				name: string;
				notnull: number;
				dflt_value: string | null;
			}>;
			expect(siteSettingsColumns).toContainEqual(
				expect.objectContaining({
					name: "commenter_reply_email_default_checked",
					notnull: 1,
					dflt_value: "0",
				}),
			);
			expect(pageThreadColumns).toContainEqual(
				expect.objectContaining({
					name: "kind",
					notnull: 1,
					dflt_value: "'public'",
				}),
			);
			expect(
				sqlite
					.prepare(
						"SELECT commenter_reply_email_default_checked AS default_checked FROM site_settings WHERE site_id = 1",
					)
					.get(),
			).toMatchObject({ default_checked: 0 });
			expect(
				sqlite
					.prepare(
						"SELECT kind FROM page_threads WHERE site_id = 1 AND page_key = 'post:existing'",
					)
					.get(),
			).toMatchObject({ kind: "public" });
			expect(
				sqlite
					.prepare(
						"SELECT name FROM __qingyan_migrations WHERE name = '0001_notification_reliability.sql'",
					)
					.get(),
			).toEqual({ name: "0001_notification_reliability.sql" });
		} finally {
			sqlite.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("backfills missing comment author user column when multi-user tables already exist", () => {
		const directory = mkdtempSync(
			path.join(tmpdir(), "qingyan-schema-author-user-"),
		);
		const databaseFile = path.join(directory, "schema.db");
		const sqlite = new Database(databaseFile);

		try {
			sqlite.exec(`
				CREATE TABLE sites (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					site_key text NOT NULL,
					name text NOT NULL,
					allowed_origins_json text NOT NULL
				);
				CREATE TABLE site_settings (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					site_id integer NOT NULL
				);
				CREATE TABLE page_threads (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					site_id integer NOT NULL,
					page_key text NOT NULL
				);
				CREATE TABLE admin_sessions (
					id text PRIMARY KEY NOT NULL,
					token_hash text NOT NULL,
					user_id integer,
					expires_at text NOT NULL,
					created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				CREATE TABLE admin_groups (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					key text NOT NULL,
					name text NOT NULL
				);
				CREATE TABLE comments (
					id text PRIMARY KEY NOT NULL,
					site_id integer NOT NULL,
					page_thread_id integer NOT NULL,
					parent_id text,
					visitor_id integer,
					author_identity text DEFAULT 'visitor' NOT NULL,
					status text DEFAULT 'pending' NOT NULL,
					author_name text NOT NULL,
					author_email text,
					author_email_hash text,
					author_website text,
					content_raw text NOT NULL,
					content_html text,
					is_pinned integer DEFAULT false NOT NULL,
					is_folded integer DEFAULT false NOT NULL,
					reply_count integer DEFAULT 0 NOT NULL,
					vote_up_count integer DEFAULT 0 NOT NULL,
					vote_down_count integer DEFAULT 0 NOT NULL,
					created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					deleted_at text
				);
				CREATE TABLE __qingyan_migrations (
					name text PRIMARY KEY NOT NULL,
					applied_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				INSERT INTO __qingyan_migrations (name) VALUES ('0000_initial.sql');
			`);

			applyDatabaseMigrations(sqlite);

			const commentColumns = sqlite
				.prepare("PRAGMA table_info(comments)")
				.all() as Array<{ name: string }>;
			expect(commentColumns.map((column) => column.name)).toContain(
				"author_user_id",
			);
		} finally {
			sqlite.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("backfills unreleased multi-user admin schema into an existing dev database", () => {
		const directory = mkdtempSync(
			path.join(tmpdir(), "qingyan-schema-legacy-"),
		);
		const databaseFile = path.join(directory, "schema.db");
		const sqlite = new Database(databaseFile);

		try {
			sqlite.exec(`
				CREATE TABLE sites (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					site_key text NOT NULL,
					name text NOT NULL,
					allowed_origins_json text NOT NULL
				);
				CREATE TABLE admin_bootstrap_state (
					id integer PRIMARY KEY NOT NULL,
					console_path text DEFAULT '/admin' NOT NULL,
					username text NOT NULL,
					password_hash text NOT NULL,
					generated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					password_rotated_at text
				);
				CREATE TABLE admin_sessions (
					id text PRIMARY KEY NOT NULL,
					token_hash text NOT NULL,
					csrf_token_hash text,
					csrf_issued_at text,
					ip text,
					user_agent text,
					expires_at text NOT NULL,
					last_seen_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				CREATE TABLE site_settings (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					site_id integer NOT NULL,
					comments_enabled integer DEFAULT true NOT NULL,
					default_status text DEFAULT 'pending' NOT NULL,
					max_depth integer DEFAULT 3 NOT NULL,
					root_limit integer DEFAULT 20 NOT NULL,
					allow_page_like integer DEFAULT true NOT NULL,
					created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				CREATE TABLE page_threads (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					site_id integer NOT NULL,
					page_key text NOT NULL
				);
				CREATE TABLE site_page_registry (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					site_id integer NOT NULL,
					page_key text NOT NULL,
					page_url text NOT NULL,
					status text DEFAULT 'active' NOT NULL,
					created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				CREATE TABLE task_runs (
					id text PRIMARY KEY NOT NULL,
					type text NOT NULL,
					category text DEFAULT 'maintenance' NOT NULL,
					status text DEFAULT 'queued' NOT NULL,
					payload_summary_json text NOT NULL,
					payload_json text NOT NULL,
					created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				CREATE TABLE task_event_logs (
					id text PRIMARY KEY NOT NULL,
					task_run_id text NOT NULL,
					event_type text NOT NULL,
					level text NOT NULL,
					message text NOT NULL,
					data_json text,
					visible_to_site_admin integer DEFAULT false NOT NULL,
					created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				CREATE TABLE __qingyan_migrations (
					name text PRIMARY KEY NOT NULL,
					applied_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				INSERT INTO __qingyan_migrations (name) VALUES ('0000_initial.sql');
			`);

			applyDatabaseMigrations(sqlite);

			const tables = sqlite
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all() as Array<{ name: string }>;
			const adminSessionColumns = sqlite
				.prepare("PRAGMA table_info(admin_sessions)")
				.all() as Array<{ name: string }>;
			const siteSettingsColumns = sqlite
				.prepare("PRAGMA table_info(site_settings)")
				.all() as Array<{ name: string }>;
			const visitorRequestMetadataColumns = sqlite
				.prepare("PRAGMA table_info(visitor_request_metadata)")
				.all() as Array<{ name: string }>;
			const taskEventLogColumns = sqlite
				.prepare("PRAGMA table_info(task_event_logs)")
				.all() as Array<{ name: string }>;
			const taskEventLogIndexes = sqlite
				.prepare("PRAGMA index_list(task_event_logs)")
				.all() as Array<{ name: string }>;

			expect(tables.map((table) => table.name)).toEqual(
				expect.arrayContaining([
					"admin_users",
					"admin_groups",
					"admin_user_groups",
					"admin_group_permissions",
					"admin_user_site_access",
					"comment_request_metadata",
					"visitor_request_metadata",
					"ip_region_database_state",
					"ip_region_update_runs",
					"pending_page_candidates",
					"pending_page_view_sessions",
					"admin_profile_verification_tokens",
					"delayed_deletions",
					"site_notification_recipients",
					"notification_channel_configs",
					"site_notification_recipient_routes",
					"admin_user_notification_preferences",
					"task_runs",
					"notification_deliveries",
					"notification_templates",
				]),
			);
			expect(adminSessionColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"user_id",
					"revoked_at",
					"revoked_by_user_id",
					"revocation_reason",
				]),
			);
			expect(siteSettingsColumns.map((column) => column.name)).toContain(
				"comment_input_limits_json",
			);
			expect(siteSettingsColumns.map((column) => column.name)).toContain(
				"engagement_json",
			);
			expect(siteSettingsColumns.map((column) => column.name)).toContain(
				"page_registry_json",
			);
			expect(siteSettingsColumns.map((column) => column.name)).toContain(
				"commenter_reply_email_enabled",
			);
			expect(siteSettingsColumns.map((column) => column.name)).toContain(
				"backend_notifications_enabled",
			);
			expect(
				visitorRequestMetadataColumns.map((column) => column.name),
			).toEqual(
				expect.arrayContaining([
					"visitor_id",
					"ip_hash",
					"user_agent_hash",
					"last_seen_at",
				]),
			);
			const taskRunColumns = sqlite
				.prepare("PRAGMA table_info(task_runs)")
				.all() as Array<{ name: string }>;
			expect(taskRunColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining(["payload_json", "idempotency_key"]),
			);
			expect(taskEventLogColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining(["sequence", "stream"]),
			);
			expect(taskEventLogIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "task_event_logs_run_sequence_idx",
					}),
					expect.objectContaining({
						name: "task_event_logs_run_created_idx",
					}),
					expect.objectContaining({
						name: "task_event_logs_level_created_idx",
					}),
				]),
			);
			const notificationChannelConfigColumns = sqlite
				.prepare("PRAGMA table_info(notification_channel_configs)")
				.all() as Array<{ name: string }>;
			const siteNotificationRecipientRouteColumns = sqlite
				.prepare("PRAGMA table_info(site_notification_recipient_routes)")
				.all() as Array<{ name: string }>;
			const deliveryColumns = sqlite
				.prepare("PRAGMA table_info(notification_deliveries)")
				.all() as Array<{ name: string }>;
			expect(
				notificationChannelConfigColumns.map((column) => column.name),
			).toEqual(expect.arrayContaining(["id", "type", "name", "config_json"]));
			expect(
				siteNotificationRecipientRouteColumns.map((column) => column.name),
			).toEqual(
				expect.arrayContaining([
					"recipient_id",
					"event_type",
					"channel_config_id",
				]),
			);
			expect(deliveryColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"channel_config_ref",
					"channel_config_name_snapshot",
				]),
			);
		} finally {
			sqlite.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
