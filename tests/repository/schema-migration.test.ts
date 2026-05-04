import Database from "better-sqlite3";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
					"page_view_sessions",
					"comments",
					"vote_records",
					"page_feedback_records",
					"captcha_sessions",
					"blacklist_rules",
					"admin_sessions",
					"admin_bootstrap_state",
					"runtime_settings",
					"system_settings",
					"audit_logs",
				]),
			);
		} finally {
			fixture.cleanup();
		}
	});

	it("keeps runtime settings unique per site and avoids provider-specific runtime settings", () => {
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
				.prepare("INSERT INTO runtime_settings (site_id) VALUES (?)")
				.run(1);

			expect(() =>
				fixture.sqlite
					.prepare("INSERT INTO runtime_settings (site_id) VALUES (?)")
					.run(1),
			).toThrow();
			expect(combinedMigrationSql).not.toContain("runtime_provider");
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
			expect(combinedMigrationSql).toContain("`comment_metadata_json` text");
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

	it("applies captcha and abuse guard schema changes to the migrated database", () => {
		const fixture = createMigratedDatabase();

		try {
			const commentsColumns = fixture.sqlite
				.prepare("PRAGMA table_info(comments)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const runtimeSettingsColumns = fixture.sqlite
				.prepare("PRAGMA table_info(runtime_settings)")
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
			const adminBootstrapColumns = fixture.sqlite
				.prepare("PRAGMA table_info(admin_bootstrap_state)")
				.all() as Array<{ name: string; dflt_value: string | null }>;

			expect(commentsColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"author_ip",
					"author_user_agent",
					"author_ip_country",
					"author_ip_region",
					"author_ip_city",
					"author_ip_isp",
					"author_ip_location_raw",
					"author_ip_location_source",
					"author_ip_location_db_hash",
					"author_ip_location_updated_at",
					"author_ip_location_error",
					"author_device_browser",
					"author_device_os",
					"author_device_type",
					"author_device_icon",
					"author_device_source",
					"author_device_parser_version",
					"author_device_updated_at",
					"author_device_error",
				]),
			);
			expect(runtimeSettingsColumns.map((column) => column.name)).toEqual(
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
					"comment_metadata_json",
				]),
			);
			expect(
				runtimeSettingsColumns.find(
					(column) => column.name === "comment_require_json",
				)?.dflt_value,
			).toBe('\'["nickname","email"]\'');
			expect(
				runtimeSettingsColumns.find((column) => column.name === "captcha_mode")
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

	it("applies missing migrations when an existing dev database starts", () => {
		const directory = mkdtempSync(path.join(tmpdir(), "qingyan-migration-"));
		const databaseFile = path.join(directory, "qingyan.db");
		mkdirSync(path.dirname(databaseFile), { recursive: true });
		const sqlite = new Database(databaseFile);

		try {
			sqlite.exec(`
				CREATE TABLE __qingyan_migrations (
					name text PRIMARY KEY NOT NULL,
					applied_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				CREATE TABLE sites (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					site_key text NOT NULL,
					name text NOT NULL,
					allowed_origins_json text NOT NULL,
					config_json text,
					created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				CREATE UNIQUE INDEX sites_site_key_idx ON sites (site_key);
				CREATE TABLE runtime_settings (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					site_id integer NOT NULL,
					comments_enabled integer DEFAULT true NOT NULL,
					default_status text DEFAULT 'pending' NOT NULL,
					max_depth integer DEFAULT 3 NOT NULL,
					root_limit integer DEFAULT 20 NOT NULL,
					comment_require_json text DEFAULT '["nickname","email"]' NOT NULL,
					allow_website integer DEFAULT true NOT NULL,
					captcha_mode text DEFAULT 'threshold' NOT NULL,
					captcha_threshold_window_sec integer DEFAULT 60 NOT NULL,
					captcha_threshold_max_actions integer DEFAULT 3 NOT NULL,
					abuse_guard_enabled integer DEFAULT true NOT NULL,
					abuse_guard_window_sec integer DEFAULT 600 NOT NULL,
					abuse_guard_max_write_actions integer DEFAULT 100 NOT NULL,
					auto_blacklist_enabled integer DEFAULT true NOT NULL,
					auto_blacklist_scope text DEFAULT 'post' NOT NULL,
					auto_blacklist_ttl_sec integer DEFAULT 1800 NOT NULL,
					email_notifications_enabled integer DEFAULT false NOT NULL,
					allow_page_like integer DEFAULT true NOT NULL,
					created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					FOREIGN KEY (site_id) REFERENCES sites(id)
				);
				CREATE UNIQUE INDEX runtime_settings_site_id_idx ON runtime_settings (site_id);
				INSERT INTO __qingyan_migrations (name) VALUES
					('0000_initial.sql'),
					('0001_classy_ben_grimm.sql'),
					('0002_public_captcha_providers.sql'),
					('0003_comment_request_metadata.sql'),
					('0004_admin_bootstrap_state.sql');
			`);

			applyDatabaseMigrations(sqlite);

			const runtimeColumns = sqlite
				.prepare("PRAGMA table_info(runtime_settings)")
				.all() as Array<{ name: string }>;
			expect(runtimeColumns.map((column) => column.name)).toContain(
				"comment_metadata_json",
			);
			expect(
				sqlite
					.prepare(
						"SELECT name FROM __qingyan_migrations WHERE name = '0005_runtime_settings_comment_metadata.sql'",
					)
					.get(),
			).toBeTruthy();
		} finally {
			sqlite.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("infers applied migrations for legacy dev databases without a migration ledger", () => {
		const directory = mkdtempSync(path.join(tmpdir(), "qingyan-migration-"));
		const databaseFile = path.join(directory, "qingyan.db");
		mkdirSync(path.dirname(databaseFile), { recursive: true });
		const sqlite = new Database(databaseFile);

		try {
			sqlite.exec(`
				CREATE TABLE sites (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					site_key text NOT NULL,
					name text NOT NULL,
					allowed_origins_json text NOT NULL,
					config_json text,
					created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				CREATE UNIQUE INDEX sites_site_key_idx ON sites (site_key);
				CREATE TABLE runtime_settings (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					site_id integer NOT NULL,
					comments_enabled integer DEFAULT true NOT NULL,
					default_status text DEFAULT 'pending' NOT NULL,
					max_depth integer DEFAULT 3 NOT NULL,
					root_limit integer DEFAULT 20 NOT NULL,
					comment_require_json text DEFAULT '["nickname","email"]' NOT NULL,
					allow_website integer DEFAULT true NOT NULL,
					captcha_mode text DEFAULT 'threshold' NOT NULL,
					captcha_threshold_window_sec integer DEFAULT 60 NOT NULL,
					captcha_threshold_max_actions integer DEFAULT 3 NOT NULL,
					abuse_guard_enabled integer DEFAULT true NOT NULL,
					abuse_guard_window_sec integer DEFAULT 600 NOT NULL,
					abuse_guard_max_write_actions integer DEFAULT 100 NOT NULL,
					auto_blacklist_enabled integer DEFAULT true NOT NULL,
					auto_blacklist_scope text DEFAULT 'post' NOT NULL,
					auto_blacklist_ttl_sec integer DEFAULT 1800 NOT NULL,
					email_notifications_enabled integer DEFAULT false NOT NULL,
					allow_page_like integer DEFAULT true NOT NULL,
					created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					FOREIGN KEY (site_id) REFERENCES sites(id)
				);
				CREATE UNIQUE INDEX runtime_settings_site_id_idx ON runtime_settings (site_id);
				CREATE TABLE system_settings (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					category text NOT NULL,
					key text NOT NULL,
					value_json text NOT NULL,
					updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				CREATE TABLE admin_bootstrap_state (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					console_path text NOT NULL,
					username text NOT NULL,
					password_hash text NOT NULL,
					generated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					password_rotated_at text
				);
				CREATE TABLE captcha_sessions (
					id text PRIMARY KEY NOT NULL,
					site_id integer NOT NULL,
					visitor_id integer NOT NULL,
					page_thread_id integer,
					triggered_by text NOT NULL,
					mode text NOT NULL,
					challenge_payload_json text,
					verified integer DEFAULT false NOT NULL,
					expires_at text NOT NULL,
					verified_at text,
					created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
					provider_kind text,
					provider_state_json text
				);
				CREATE TABLE comments (
					id text PRIMARY KEY NOT NULL,
					site_id integer NOT NULL,
					page_thread_id integer NOT NULL,
					parent_id text,
					visitor_id integer,
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
					deleted_at text,
					author_ip text
				);
				CREATE TABLE ip_region_database_state (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					ip_version text NOT NULL,
					file_path text NOT NULL,
					file_hash text NOT NULL,
					source_url text,
					cache_policy text NOT NULL,
					activated_at text NOT NULL,
					updated_at text NOT NULL
				);
			`);

			applyDatabaseMigrations(sqlite);

			const runtimeColumns = sqlite
				.prepare("PRAGMA table_info(runtime_settings)")
				.all() as Array<{ name: string }>;
			expect(runtimeColumns.map((column) => column.name)).toContain(
				"comment_metadata_json",
			);
			const applied = sqlite
				.prepare("SELECT name FROM __qingyan_migrations ORDER BY name")
				.all() as Array<{ name: string }>;
			expect(applied.map((record) => record.name)).toContain(
				"0005_runtime_settings_comment_metadata.sql",
			);
		} finally {
			sqlite.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
