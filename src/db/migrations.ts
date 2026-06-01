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

			CREATE TABLE IF NOT EXISTS email_verification_tokens (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				user_id integer NOT NULL,
				new_email text NOT NULL,
				token_hash text NOT NULL,
				expires_at text NOT NULL,
				consumed_at text,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE INDEX IF NOT EXISTS email_verification_tokens_user_id_idx ON email_verification_tokens (user_id);
			CREATE UNIQUE INDEX IF NOT EXISTS email_verification_tokens_token_hash_idx ON email_verification_tokens (token_hash);

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

function applyUnreleasedBaselineBackfill(sqlite: SqliteClient): void {
	const applyBackfill = sqlite.transaction(() => {
		if (tableExists(sqlite, "site_settings")) {
			addColumnIfMissing(sqlite, "site_settings", "engagement_json", "text");
		}

		if (tableExists(sqlite, "maintenance_jobs")) {
			addColumnIfMissing(
				sqlite,
				"maintenance_jobs",
				"priority",
				"integer DEFAULT 0 NOT NULL",
			);
		}

		if (tableExists(sqlite, "site_page_registry_sources")) {
			sqlite.exec(`
				CREATE TABLE IF NOT EXISTS site_page_registry_source_pages (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					source_id integer NOT NULL,
					page_registry_id integer NOT NULL,
					first_seen_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					last_seen_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					FOREIGN KEY (source_id) REFERENCES site_page_registry_sources(id) ON UPDATE no action ON DELETE no action,
					FOREIGN KEY (page_registry_id) REFERENCES site_page_registry(id) ON UPDATE no action ON DELETE no action
				);
				CREATE UNIQUE INDEX IF NOT EXISTS site_page_registry_source_pages_source_page_idx ON site_page_registry_source_pages (source_id, page_registry_id);
				CREATE INDEX IF NOT EXISTS site_page_registry_source_pages_page_idx ON site_page_registry_source_pages (page_registry_id);
			`);
		}

		sqlite.exec(`
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

			CREATE TABLE IF NOT EXISTS email_verification_tokens (
				id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
				user_id integer NOT NULL,
				new_email text NOT NULL,
				token_hash text NOT NULL,
				expires_at text NOT NULL,
				consumed_at text,
				created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
				FOREIGN KEY (user_id) REFERENCES admin_users(id) ON UPDATE no action ON DELETE no action
			);
			CREATE INDEX IF NOT EXISTS email_verification_tokens_user_id_idx ON email_verification_tokens (user_id);
			CREATE UNIQUE INDEX IF NOT EXISTS email_verification_tokens_token_hash_idx ON email_verification_tokens (token_hash);

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
