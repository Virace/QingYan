import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { SqliteClient } from "./client";

function splitMigrationStatements(sql: string): string[] {
	return sql
		.split("--> statement-breakpoint")
		.map((statement) => statement.trim())
		.filter(Boolean);
}

function tableExists(sqlite: SqliteClient, tableName: string): boolean {
	return Boolean(
		sqlite
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
			)
			.get(tableName),
	);
}

function columnExists(
	sqlite: SqliteClient,
	tableName: string,
	columnName: string,
): boolean {
	const columns = sqlite
		.prepare(`PRAGMA table_info(${tableName})`)
		.all() as Array<{
		name: string;
	}>;
	return columns.some((column) => column.name === columnName);
}

function inferAppliedMigrations(sqlite: SqliteClient): string[] {
	if (!tableExists(sqlite, "sites")) {
		return [];
	}

	return ["0000_initial.sql"];
}

function applyUnreleasedMultiUserAdminBackfill(sqlite: SqliteClient): void {
	const applyBackfill = sqlite.transaction(() => {
		sqlite.exec(`
			CREATE TABLE IF NOT EXISTS admin_users (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				username text NOT NULL,
				email text NOT NULL,
				password_hash text NOT NULL,
				display_name text NOT NULL,
				website text,
				avatar_url text,
				status text DEFAULT 'active' NOT NULL,
				is_initial_admin integer DEFAULT false NOT NULL,
				password_change_required integer DEFAULT false NOT NULL,
				login_blocked_until text,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				password_rotated_at text,
				last_login_at text,
				deleted_at text
			);
			CREATE UNIQUE INDEX IF NOT EXISTS admin_users_username_idx ON admin_users (username);
			CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_idx ON admin_users (email);
			CREATE INDEX IF NOT EXISTS admin_users_status_idx ON admin_users (status);

			CREATE TABLE IF NOT EXISTS admin_groups (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				key text NOT NULL,
				name text NOT NULL,
				description text,
				kind text DEFAULT 'system' NOT NULL,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
			);
			CREATE UNIQUE INDEX IF NOT EXISTS admin_groups_key_idx ON admin_groups (key);

			CREATE TABLE IF NOT EXISTS admin_user_groups (
				user_id integer NOT NULL,
				group_id integer NOT NULL,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				created_by_user_id integer,
				FOREIGN KEY (user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (group_id) REFERENCES admin_groups(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (created_by_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE UNIQUE INDEX IF NOT EXISTS admin_user_groups_user_idx ON admin_user_groups (user_id);
			CREATE INDEX IF NOT EXISTS admin_user_groups_group_idx ON admin_user_groups (group_id);

			CREATE TABLE IF NOT EXISTS admin_group_permissions (
				group_id integer NOT NULL,
				permission_key text NOT NULL,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				created_by_user_id integer,
				FOREIGN KEY (group_id) REFERENCES admin_groups(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (created_by_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE UNIQUE INDEX IF NOT EXISTS admin_group_permissions_group_permission_idx ON admin_group_permissions (group_id, permission_key);

			CREATE TABLE IF NOT EXISTS admin_user_site_access (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				user_id integer NOT NULL,
				site_id integer NOT NULL,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				created_by_user_id integer,
				FOREIGN KEY (user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (site_id) REFERENCES sites(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (created_by_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE UNIQUE INDEX IF NOT EXISTS admin_user_site_access_user_site_idx ON admin_user_site_access (user_id, site_id);
			CREATE INDEX IF NOT EXISTS admin_user_site_access_site_idx ON admin_user_site_access (site_id);

			CREATE TABLE IF NOT EXISTS admin_profile_verification_tokens (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				purpose text NOT NULL,
				user_id integer NOT NULL,
				token_hash text NOT NULL,
				new_email text,
				pending_password_hash text,
				expires_at text NOT NULL,
				consumed_at text,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE INDEX IF NOT EXISTS admin_profile_verification_tokens_user_id_idx ON admin_profile_verification_tokens (user_id);
			CREATE UNIQUE INDEX IF NOT EXISTS admin_profile_verification_tokens_token_hash_idx ON admin_profile_verification_tokens (token_hash);

			CREATE TABLE IF NOT EXISTS delayed_deletions (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				resource_type text NOT NULL,
				resource_id text NOT NULL,
				site_id integer,
				requested_by_user_id integer,
				requested_at text NOT NULL,
				hard_delete_after text NOT NULL,
				restored_by_user_id integer,
				restored_at text,
				hard_deleted_at text,
				status text DEFAULT 'pending' NOT NULL,
				metadata_json text,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (site_id) REFERENCES sites(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (requested_by_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (restored_by_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE INDEX IF NOT EXISTS delayed_deletions_status_due_idx ON delayed_deletions (status, hard_delete_after);
			CREATE INDEX IF NOT EXISTS delayed_deletions_site_id_idx ON delayed_deletions (site_id);
			CREATE INDEX IF NOT EXISTS delayed_deletions_resource_idx ON delayed_deletions (resource_type, resource_id);
		`);

		for (const column of [
			["user_id", "integer"],
			["revoked_at", "text"],
			["revoked_by_user_id", "integer"],
			["revocation_reason", "text"],
		] as const) {
			if (!columnExists(sqlite, "admin_sessions", column[0])) {
				sqlite.exec(
					`ALTER TABLE admin_sessions ADD COLUMN ${column[0]} ${column[1]}`,
				);
			}
		}

		if (tableExists(sqlite, "comments")) {
			addColumnIfMissing(sqlite, "comments", "author_user_id", "integer");
		}
	});

	applyBackfill();
}

function addColumnIfMissing(
	sqlite: SqliteClient,
	tableName: string,
	columnName: string,
	definition: string,
): void {
	if (!columnExists(sqlite, tableName, columnName)) {
		sqlite.exec(
			`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
		);
	}
}

function indexExists(sqlite: SqliteClient, indexName: string): boolean {
	return Boolean(
		sqlite
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
			)
			.get(indexName),
	);
}

function applyUnreleasedBaselineBackfill(sqlite: SqliteClient): void {
	const applyBackfill = sqlite.transaction(() => {
		if (tableExists(sqlite, "site_settings")) {
			addColumnIfMissing(sqlite, "site_settings", "engagement_json", "text");
			addColumnIfMissing(sqlite, "site_settings", "page_registry_json", "text");
			addColumnIfMissing(
				sqlite,
				"site_settings",
				"commenter_reply_email_enabled",
				"integer NOT NULL DEFAULT 0",
			);
			addColumnIfMissing(
				sqlite,
				"site_settings",
				"backend_notifications_enabled",
				"integer NOT NULL DEFAULT 0",
			);
			if (
				columnExists(sqlite, "site_settings", "email_notifications_enabled")
			) {
				sqlite.exec(`
					UPDATE site_settings
					SET commenter_reply_email_enabled = COALESCE(email_notifications_enabled, 0)
					WHERE commenter_reply_email_enabled IS NULL OR commenter_reply_email_enabled = 0
				`);
			}
		}

		if (tableExists(sqlite, "comments")) {
			addColumnIfMissing(sqlite, "comments", "author_user_id", "integer");
		}

		sqlite.exec(`
			CREATE TABLE IF NOT EXISTS task_runs (
				id text PRIMARY KEY NOT NULL,
				queue_backend text NOT NULL,
				queue_message_id text,
				type text NOT NULL,
				category text NOT NULL,
				status text NOT NULL,
				site_id integer,
				site_key text,
				actor_type text,
				actor_id text,
				subject_type text,
				subject_id text,
				payload_summary_json text NOT NULL,
				payload_json text NOT NULL,
				progress_json text,
				result_json text,
				error_json text,
				idempotency_key text,
				run_after text,
				attempts integer DEFAULT 0 NOT NULL,
				max_attempts integer DEFAULT 1 NOT NULL,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				started_at text,
				finished_at text,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (site_id) REFERENCES sites(id) ON UPDATE no action ON DELETE no action
			);

			CREATE TABLE IF NOT EXISTS notification_deliveries (
				id text PRIMARY KEY NOT NULL,
				task_run_id text NOT NULL,
				channel text NOT NULL,
				channel_config_ref text,
				channel_config_name_snapshot text,
				recipient_type text NOT NULL,
				recipient_user_id integer,
				recipient_address_snapshot text NOT NULL,
				recipient_identity_key text NOT NULL,
				event_family text NOT NULL DEFAULT 'unknown',
				template_key text NOT NULL,
				status text NOT NULL,
				provider_message_id text,
				last_error_json text,
				sent_at text,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (recipient_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE INDEX IF NOT EXISTS notification_deliveries_task_run_idx ON notification_deliveries (task_run_id);
			CREATE INDEX IF NOT EXISTS notification_deliveries_recipient_idx ON notification_deliveries (recipient_type, recipient_identity_key);
			CREATE INDEX IF NOT EXISTS notification_deliveries_status_idx ON notification_deliveries (status);

			CREATE TABLE IF NOT EXISTS comment_request_metadata (
				comment_id text PRIMARY KEY NOT NULL,
				author_ip text,
				author_user_agent text,
				ip_country text,
				ip_region text,
				ip_city text,
				ip_isp text,
				ip_location_raw text,
				ip_location_source text,
				ip_location_db_hash text,
				ip_location_updated_at text,
				ip_location_error text,
				device_browser text,
				device_browser_version text,
				device_os text,
				device_os_version text,
				device_type text,
				device_icon text,
				device_source text,
				device_parser_version text,
				device_updated_at text,
				device_error text,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (comment_id) REFERENCES comments(id) ON UPDATE no action ON DELETE no action
			);

			CREATE TABLE IF NOT EXISTS visitor_request_metadata (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				site_id integer NOT NULL,
				visitor_id integer NOT NULL,
				ip text,
				ip_hash text,
				user_agent text,
				user_agent_hash text,
				ip_country text,
				ip_region text,
				ip_city text,
				ip_isp text,
				ip_location_raw text,
				ip_location_source text,
				ip_location_db_hash text,
				ip_location_updated_at text,
				ip_location_error text,
				device_browser text,
				device_browser_version text,
				device_os text,
				device_os_version text,
				device_type text,
				device_icon text,
				device_source text,
				device_parser_version text,
				device_updated_at text,
				device_error text,
				first_seen_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				last_seen_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				seen_count integer DEFAULT 1 NOT NULL,
				last_seen_page_key text,
				last_seen_page_url text,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (site_id) REFERENCES sites(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON UPDATE no action ON DELETE no action
			);
			CREATE INDEX IF NOT EXISTS visitor_request_metadata_site_id_idx ON visitor_request_metadata (site_id);
			CREATE INDEX IF NOT EXISTS visitor_request_metadata_visitor_id_idx ON visitor_request_metadata (visitor_id);
			CREATE INDEX IF NOT EXISTS visitor_request_metadata_last_seen_at_idx ON visitor_request_metadata (last_seen_at);
			CREATE UNIQUE INDEX IF NOT EXISTS visitor_request_metadata_identity_idx ON visitor_request_metadata (visitor_id, ip_hash, user_agent_hash);

			CREATE TABLE IF NOT EXISTS ip_region_database_state (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				ip_version text NOT NULL,
				file_path text NOT NULL,
				file_hash text NOT NULL,
				source_url text,
				cache_policy text NOT NULL,
				activated_at text NOT NULL,
				updated_at text NOT NULL
			);
			CREATE UNIQUE INDEX IF NOT EXISTS ip_region_database_state_version_idx ON ip_region_database_state (ip_version);

			CREATE TABLE IF NOT EXISTS ip_region_update_runs (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				ip_version text NOT NULL,
				source_url text,
				status text NOT NULL,
				previous_hash text,
				next_hash text,
				downloaded_at text,
				activated_at text,
				refreshed_comments integer DEFAULT 0 NOT NULL,
				error_message text,
				created_at text NOT NULL,
				updated_at text NOT NULL
			);

			CREATE TABLE IF NOT EXISTS pending_page_candidates (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				site_key text NOT NULL,
				page_key text NOT NULL,
				page_url text NOT NULL,
				first_seen_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				last_seen_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				hit_count integer DEFAULT 0 NOT NULL,
				status text DEFAULT 'pending' NOT NULL,
				last_reject_reason text,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
			);
			CREATE UNIQUE INDEX IF NOT EXISTS pending_page_candidates_site_page_key_idx ON pending_page_candidates (site_key, page_key);
			CREATE INDEX IF NOT EXISTS pending_page_candidates_site_status_idx ON pending_page_candidates (site_key, status);

			CREATE TABLE IF NOT EXISTS pending_page_view_sessions (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				site_key text NOT NULL,
				page_key text NOT NULL,
				fingerprint text NOT NULL,
				first_seen_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				last_seen_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				hit_count integer DEFAULT 1 NOT NULL,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
			);
			CREATE UNIQUE INDEX IF NOT EXISTS pending_page_view_sessions_page_fingerprint_idx ON pending_page_view_sessions (site_key, page_key, fingerprint);
			CREATE INDEX IF NOT EXISTS pending_page_view_sessions_site_page_idx ON pending_page_view_sessions (site_key, page_key);

			CREATE TABLE IF NOT EXISTS admin_profile_verification_tokens (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				purpose text NOT NULL,
				user_id integer NOT NULL,
				token_hash text NOT NULL,
				new_email text,
				pending_password_hash text,
				expires_at text NOT NULL,
				consumed_at text,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE INDEX IF NOT EXISTS admin_profile_verification_tokens_user_id_idx ON admin_profile_verification_tokens (user_id);
			CREATE UNIQUE INDEX IF NOT EXISTS admin_profile_verification_tokens_token_hash_idx ON admin_profile_verification_tokens (token_hash);

			CREATE TABLE IF NOT EXISTS delayed_deletions (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				resource_type text NOT NULL,
				resource_id text NOT NULL,
				site_id integer,
				requested_by_user_id integer,
				requested_at text NOT NULL,
				hard_delete_after text NOT NULL,
				restored_by_user_id integer,
				restored_at text,
				hard_deleted_at text,
				status text DEFAULT 'pending' NOT NULL,
				metadata_json text,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (site_id) REFERENCES sites(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (requested_by_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (restored_by_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE INDEX IF NOT EXISTS delayed_deletions_status_due_idx ON delayed_deletions (status, hard_delete_after);
			CREATE INDEX IF NOT EXISTS delayed_deletions_site_id_idx ON delayed_deletions (site_id);
			CREATE INDEX IF NOT EXISTS delayed_deletions_resource_idx ON delayed_deletions (resource_type, resource_id);

			CREATE TABLE IF NOT EXISTS site_notification_recipients (
				id text PRIMARY KEY NOT NULL,
				site_id integer NOT NULL,
				user_id integer NOT NULL,
				channels_json text DEFAULT '[]' NOT NULL,
				events_json text DEFAULT '[]' NOT NULL,
				include_comment_content text NOT NULL,
				rate_limit_profile text,
				enabled integer DEFAULT true NOT NULL,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (site_id) REFERENCES sites(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE UNIQUE INDEX IF NOT EXISTS site_notification_recipients_site_user_idx ON site_notification_recipients (site_id, user_id);
			CREATE INDEX IF NOT EXISTS site_notification_recipients_site_idx ON site_notification_recipients (site_id);
			CREATE INDEX IF NOT EXISTS site_notification_recipients_user_idx ON site_notification_recipients (user_id);

			CREATE TABLE IF NOT EXISTS notification_channel_configs (
				id text PRIMARY KEY NOT NULL,
				type text NOT NULL,
				name text NOT NULL,
				description text,
				enabled integer DEFAULT true NOT NULL,
				config_json text NOT NULL,
				secret_config_json text DEFAULT '{}' NOT NULL,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
			);
			CREATE INDEX IF NOT EXISTS notification_channel_configs_type_idx ON notification_channel_configs (type);
			CREATE INDEX IF NOT EXISTS notification_channel_configs_enabled_idx ON notification_channel_configs (enabled);
			INSERT OR IGNORE INTO notification_channel_configs (id, type, name, description, enabled, config_json, secret_config_json)
			VALUES ('email:default', 'email', '默认邮件', '使用系统 SMTP 设置发送邮件通知。', true, '{}', '{}');

			CREATE TABLE IF NOT EXISTS site_notification_recipient_routes (
				id text PRIMARY KEY NOT NULL,
				recipient_id text NOT NULL,
				event_type text NOT NULL,
				channel_config_id text NOT NULL,
				enabled integer DEFAULT true NOT NULL,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (recipient_id) REFERENCES site_notification_recipients(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (channel_config_id) REFERENCES notification_channel_configs(id) ON UPDATE no action ON DELETE no action
			);
			CREATE INDEX IF NOT EXISTS site_notification_recipient_routes_recipient_idx ON site_notification_recipient_routes (recipient_id);
			CREATE INDEX IF NOT EXISTS site_notification_recipient_routes_config_idx ON site_notification_recipient_routes (channel_config_id);
			CREATE UNIQUE INDEX IF NOT EXISTS site_notification_recipient_routes_unique_idx ON site_notification_recipient_routes (recipient_id, event_type, channel_config_id);

			CREATE TABLE IF NOT EXISTS admin_user_notification_preferences (
				user_id integer NOT NULL,
				channel text NOT NULL,
				enabled integer DEFAULT true NOT NULL,
				digest_mode text DEFAULT 'off' NOT NULL,
				digest_interval_minutes integer,
				digest_times_json text,
				paused_until text,
				channel_config_ref text,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE UNIQUE INDEX IF NOT EXISTS admin_user_notification_preferences_user_config_idx ON admin_user_notification_preferences (user_id, channel_config_ref);

			CREATE TABLE IF NOT EXISTS commenter_notification_preferences (
				id text PRIMARY KEY NOT NULL,
				site_id integer NOT NULL,
				email text NOT NULL,
				email_hash text NOT NULL,
				notify_on_reply integer DEFAULT false NOT NULL,
				unsubscribed_at text,
				source text NOT NULL,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (site_id) REFERENCES sites(id) ON UPDATE no action ON DELETE no action
			);
			CREATE UNIQUE INDEX IF NOT EXISTS commenter_notification_preferences_site_email_idx ON commenter_notification_preferences (site_id, email_hash);
			CREATE INDEX IF NOT EXISTS commenter_notification_preferences_site_idx ON commenter_notification_preferences (site_id);

			CREATE TABLE IF NOT EXISTS email_delivery_reputation (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				site_id integer NOT NULL,
				email text NOT NULL,
				email_hash text NOT NULL,
				failure_score integer DEFAULT 0 NOT NULL,
				last_failure_at text,
				last_success_at text,
				suppressed_until text,
				suppressed_reason text,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (site_id) REFERENCES sites(id) ON UPDATE no action ON DELETE no action
			);
			CREATE UNIQUE INDEX IF NOT EXISTS email_delivery_reputation_site_email_idx ON email_delivery_reputation (site_id, email_hash);
			CREATE INDEX IF NOT EXISTS email_delivery_reputation_site_idx ON email_delivery_reputation (site_id);

			CREATE TABLE IF NOT EXISTS unsubscribe_tokens (
				id text PRIMARY KEY NOT NULL,
				site_id integer NOT NULL,
				email_hash text NOT NULL,
				token_hash text NOT NULL,
				purpose text NOT NULL,
				expires_at text,
				consumed_at text,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (site_id) REFERENCES sites(id) ON UPDATE no action ON DELETE no action
			);
			CREATE UNIQUE INDEX IF NOT EXISTS unsubscribe_tokens_token_hash_idx ON unsubscribe_tokens (token_hash);
			CREATE INDEX IF NOT EXISTS unsubscribe_tokens_site_email_idx ON unsubscribe_tokens (site_id, email_hash);

			CREATE TABLE IF NOT EXISTS notification_templates (
				key text PRIMARY KEY NOT NULL,
				channel text NOT NULL,
				event_type text NOT NULL,
				format text NOT NULL,
				subject_template text,
				body_template text NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_by_user_id integer,
				FOREIGN KEY (updated_by_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE INDEX IF NOT EXISTS notification_templates_channel_event_idx ON notification_templates (channel, event_type);
		`);

		if (tableExists(sqlite, "site_notification_recipients")) {
			addColumnIfMissing(
				sqlite,
				"site_notification_recipients",
				"channels_json",
				"text DEFAULT '[]' NOT NULL",
			);
			addColumnIfMissing(
				sqlite,
				"site_notification_recipients",
				"events_json",
				"text DEFAULT '[]' NOT NULL",
			);
		}

		if (tableExists(sqlite, "notification_deliveries")) {
			addColumnIfMissing(
				sqlite,
				"notification_deliveries",
				"channel_config_ref",
				"text",
			);
			addColumnIfMissing(
				sqlite,
				"notification_deliveries",
				"channel_config_name_snapshot",
				"text",
			);
		}

		sqlite.exec(`
			CREATE TABLE IF NOT EXISTS scheduled_tasks (
				id text PRIMARY KEY NOT NULL,
				name text NOT NULL,
				description text,
				type text NOT NULL,
				site_id integer,
				scope_kind text NOT NULL,
				scope_json text NOT NULL,
				enabled integer DEFAULT false NOT NULL,
				disabled_reason text,
				schedule_kind text NOT NULL,
				schedule_preset text,
				cron_expression text,
				timezone text,
				payload_json text NOT NULL,
				payload_schema_version integer DEFAULT 1 NOT NULL,
				system_key text,
				protection_json text,
				policy_json text NOT NULL,
				trigger_json text NOT NULL,
				trigger_schema_version integer DEFAULT 1 NOT NULL,
				next_run_at text,
				claim_worker_id text,
				claim_expires_at text,
				last_run_at text,
				last_run_id text,
				last_status text,
				retention_count integer DEFAULT 5 NOT NULL,
				owner_user_id integer NOT NULL,
				created_by_user_id integer,
				updated_by_user_id integer,
				transferred_by_user_id integer,
				transferred_at text,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				deleted_at text,
				FOREIGN KEY (site_id) REFERENCES sites(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (owner_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (created_by_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (updated_by_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action,
				FOREIGN KEY (transferred_by_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE INDEX IF NOT EXISTS scheduled_tasks_enabled_next_run_idx ON scheduled_tasks (enabled, next_run_at);
			CREATE INDEX IF NOT EXISTS scheduled_tasks_site_type_idx ON scheduled_tasks (site_id, type);
			CREATE INDEX IF NOT EXISTS scheduled_tasks_owner_idx ON scheduled_tasks (owner_user_id);
			CREATE INDEX IF NOT EXISTS scheduled_tasks_deleted_idx ON scheduled_tasks (deleted_at);

			CREATE TABLE IF NOT EXISTS scheduled_task_deleted_snapshots (
				id text PRIMARY KEY NOT NULL,
				scheduled_task_id text NOT NULL,
				snapshot_json text NOT NULL,
				deleted_by_user_id integer,
				deleted_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				delete_reason text,
				last_run_id text,
				last_status text,
				FOREIGN KEY (deleted_by_user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE INDEX IF NOT EXISTS scheduled_task_deleted_snapshots_task_idx ON scheduled_task_deleted_snapshots (scheduled_task_id);
			CREATE INDEX IF NOT EXISTS scheduled_task_deleted_snapshots_deleted_idx ON scheduled_task_deleted_snapshots (deleted_at);
		`);

		if (tableExists(sqlite, "scheduled_tasks")) {
			addColumnIfMissing(sqlite, "scheduled_tasks", "claim_worker_id", "text");
			addColumnIfMissing(sqlite, "scheduled_tasks", "claim_expires_at", "text");
			addColumnIfMissing(sqlite, "scheduled_tasks", "system_key", "text");
			addColumnIfMissing(sqlite, "scheduled_tasks", "protection_json", "text");
			sqlite.exec(`
				CREATE INDEX IF NOT EXISTS scheduled_tasks_claim_expires_idx ON scheduled_tasks (claim_expires_at);
				CREATE INDEX IF NOT EXISTS scheduled_tasks_system_key_idx ON scheduled_tasks (system_key);
			`);
		}

		if (tableExists(sqlite, "task_runs")) {
			addColumnIfMissing(
				sqlite,
				"task_runs",
				"queue_backend",
				"text DEFAULT 'database' NOT NULL",
			);
			addColumnIfMissing(sqlite, "task_runs", "queue_message_id", "text");
			addColumnIfMissing(sqlite, "task_runs", "site_id", "integer");
			addColumnIfMissing(sqlite, "task_runs", "site_key", "text");
			addColumnIfMissing(sqlite, "task_runs", "actor_type", "text");
			addColumnIfMissing(sqlite, "task_runs", "actor_id", "text");
			addColumnIfMissing(sqlite, "task_runs", "subject_type", "text");
			addColumnIfMissing(sqlite, "task_runs", "subject_id", "text");
			addColumnIfMissing(sqlite, "task_runs", "progress_json", "text");
			addColumnIfMissing(sqlite, "task_runs", "result_json", "text");
			addColumnIfMissing(sqlite, "task_runs", "error_json", "text");
			addColumnIfMissing(sqlite, "task_runs", "idempotency_key", "text");
			addColumnIfMissing(sqlite, "task_runs", "run_after", "text");
			addColumnIfMissing(
				sqlite,
				"task_runs",
				"attempts",
				"integer DEFAULT 0 NOT NULL",
			);
			addColumnIfMissing(
				sqlite,
				"task_runs",
				"max_attempts",
				"integer DEFAULT 1 NOT NULL",
			);
			addColumnIfMissing(sqlite, "task_runs", "started_at", "text");
			addColumnIfMissing(sqlite, "task_runs", "finished_at", "text");
			addColumnIfMissing(sqlite, "task_runs", "scheduled_task_id", "text");
			addColumnIfMissing(
				sqlite,
				"task_runs",
				"scheduled_task_name_snapshot",
				"text",
			);
			addColumnIfMissing(sqlite, "task_runs", "scope_kind", "text");
			addColumnIfMissing(sqlite, "task_runs", "trigger", "text");
			addColumnIfMissing(sqlite, "task_runs", "trigger_snapshot_json", "text");
			addColumnIfMissing(sqlite, "task_runs", "scope_json", "text");
			addColumnIfMissing(sqlite, "task_runs", "input_json", "text");
			addColumnIfMissing(
				sqlite,
				"task_runs",
				"action_config_snapshot_json",
				"text",
			);
			addColumnIfMissing(sqlite, "task_runs", "skip_reason", "text");
			addColumnIfMissing(sqlite, "task_runs", "block_reason", "text");
			addColumnIfMissing(
				sqlite,
				"task_runs",
				"retry_delay_sec",
				"integer DEFAULT 0 NOT NULL",
			);
			addColumnIfMissing(
				sqlite,
				"task_runs",
				"priority",
				"integer DEFAULT 0 NOT NULL",
			);
			addColumnIfMissing(sqlite, "task_runs", "concurrency_key", "text");
			addColumnIfMissing(sqlite, "task_runs", "worker_id", "text");
			addColumnIfMissing(
				sqlite,
				"task_runs",
				"lock_conflict_with_run_id",
				"text",
			);
			addColumnIfMissing(
				sqlite,
				"task_runs",
				"lock_conflict_with_task_name",
				"text",
			);
			addColumnIfMissing(
				sqlite,
				"task_runs",
				"owner_user_id_snapshot",
				"integer",
			);
			addColumnIfMissing(sqlite, "task_runs", "created_by_user_id", "integer");
			sqlite.exec(`
				CREATE INDEX IF NOT EXISTS task_runs_scheduled_task_created_idx ON task_runs (scheduled_task_id, created_at);
				CREATE INDEX IF NOT EXISTS task_runs_status_run_after_idx ON task_runs (status, run_after);
				CREATE INDEX IF NOT EXISTS task_runs_type_status_run_after_idx ON task_runs (type, status, run_after);
				CREATE INDEX IF NOT EXISTS task_runs_category_created_idx ON task_runs (category, created_at);
				CREATE INDEX IF NOT EXISTS task_runs_site_idx ON task_runs (site_id);
				CREATE INDEX IF NOT EXISTS task_runs_site_created_idx ON task_runs (site_id, created_at);
				CREATE INDEX IF NOT EXISTS task_runs_concurrency_status_idx ON task_runs (concurrency_key, status);
				CREATE UNIQUE INDEX IF NOT EXISTS task_runs_idempotency_idx ON task_runs (idempotency_key);
			`);
		}

		sqlite.exec(`
			CREATE TABLE IF NOT EXISTS task_event_logs (
				id text PRIMARY KEY NOT NULL,
				task_run_id text NOT NULL,
				sequence integer DEFAULT 0 NOT NULL,
				stream text DEFAULT 'system' NOT NULL,
				event_type text NOT NULL,
				level text NOT NULL,
				message text NOT NULL,
				data_json text,
				visible_to_site_admin integer DEFAULT false NOT NULL,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON UPDATE no action ON DELETE no action
			);
		`);
		if (tableExists(sqlite, "task_event_logs")) {
			addColumnIfMissing(
				sqlite,
				"task_event_logs",
				"sequence",
				"integer DEFAULT 0 NOT NULL",
			);
			addColumnIfMissing(
				sqlite,
				"task_event_logs",
				"stream",
				"text DEFAULT 'system' NOT NULL",
			);
			sqlite.exec(`
				CREATE INDEX IF NOT EXISTS task_event_logs_run_sequence_idx ON task_event_logs (task_run_id, sequence);
				CREATE INDEX IF NOT EXISTS task_event_logs_run_created_idx ON task_event_logs (task_run_id, created_at);
				CREATE INDEX IF NOT EXISTS task_event_logs_level_created_idx ON task_event_logs (level, created_at);
			`);
		}

		sqlite.exec(`
			CREATE TABLE IF NOT EXISTS task_metric_rollups (
				id text PRIMARY KEY NOT NULL,
				site_id integer,
				site_key text DEFAULT '__global__' NOT NULL,
				metric_key text NOT NULL,
				bucket_start_at text NOT NULL,
				bucket_size_sec integer NOT NULL,
				dimension_json text NOT NULL,
				value real DEFAULT 0 NOT NULL,
				sample_count integer DEFAULT 0 NOT NULL,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (site_id) REFERENCES sites(id) ON UPDATE no action ON DELETE no action
			);
			CREATE INDEX IF NOT EXISTS task_metric_rollups_site_metric_bucket_idx ON task_metric_rollups (site_id, metric_key, bucket_start_at);
			CREATE INDEX IF NOT EXISTS task_metric_rollups_metric_bucket_idx ON task_metric_rollups (metric_key, bucket_start_at);
			CREATE UNIQUE INDEX IF NOT EXISTS task_metric_rollups_unique_bucket_idx ON task_metric_rollups (site_key, metric_key, bucket_start_at, bucket_size_sec, dimension_json);
		`);

		if (
			tableExists(sqlite, "admin_user_notification_preferences") &&
			columnExists(
				sqlite,
				"admin_user_notification_preferences",
				"channel_config_ref",
			)
		) {
			sqlite.exec(`
				UPDATE admin_user_notification_preferences
				SET channel_config_ref = CASE
					WHEN channel = 'email' THEN 'email:default'
					WHEN channel_config_ref IS NULL OR channel_config_ref = '' THEN channel
					ELSE channel_config_ref
				END
			`);
			if (
				!indexExists(
					sqlite,
					"admin_user_notification_preferences_user_config_idx",
				)
			) {
				sqlite.exec(
					"CREATE UNIQUE INDEX IF NOT EXISTS admin_user_notification_preferences_user_config_idx ON admin_user_notification_preferences (user_id, channel_config_ref)",
				);
			}
		}
	});

	applyBackfill();
}

export function applyDatabaseMigrations(
	sqlite: SqliteClient,
	migrationDirectory = path.resolve(process.cwd(), "drizzle"),
): void {
	const hadMigrationTable = tableExists(sqlite, "__qingyan_migrations");
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS __qingyan_migrations (
			name text PRIMARY KEY NOT NULL,
			applied_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
		)
	`);

	const files = readdirSync(migrationDirectory)
		.filter((fileName) => fileName.endsWith(".sql"))
		.sort();

	const selectApplied = sqlite.prepare(
		"SELECT name FROM __qingyan_migrations WHERE name = ?",
	);
	const insertApplied = sqlite.prepare(
		"INSERT INTO __qingyan_migrations (name) VALUES (?)",
	);

	if (!hadMigrationTable) {
		for (const fileName of inferAppliedMigrations(sqlite)) {
			insertApplied.run(fileName);
		}
	}

	for (const fileName of files) {
		const existing = selectApplied.get(fileName);
		if (existing) {
			continue;
		}

		const sql = readFileSync(path.join(migrationDirectory, fileName), "utf-8");
		const statements = splitMigrationStatements(sql);
		const applyOne = sqlite.transaction(() => {
			for (const statement of statements) {
				sqlite.exec(statement);
			}
			insertApplied.run(fileName);
		});
		applyOne();
	}

	if (tableExists(sqlite, "sites") && tableExists(sqlite, "admin_sessions")) {
		applyUnreleasedBaselineBackfill(sqlite);
		if (
			!tableExists(sqlite, "admin_groups") ||
			!columnExists(sqlite, "admin_sessions", "user_id")
		) {
			applyUnreleasedMultiUserAdminBackfill(sqlite);
		}
	}
}
