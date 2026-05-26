import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

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
					"site_settings",
					"system_settings",
					"__qingyan_upgrades",
					"audit_logs",
					"import_batches",
					"import_records",
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
			const adminSessionColumns = fixture.sqlite
				.prepare("PRAGMA table_info(admin_sessions)")
				.all() as Array<{ name: string; type: string }>;
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
					"comment_metadata_json",
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
			expect(adminSessionColumns).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "previous_csrf_token_hash",
						type: "TEXT",
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

	it("keeps schema migrations ordered for fresh and existing databases", () => {
		const migrationFiles = readdirSync(path.resolve(process.cwd(), "drizzle"))
			.filter((fileName) => fileName.endsWith(".sql"))
			.sort();

		expect(migrationFiles).toEqual([
			"0000_initial.sql",
			"0001_admin_sessions_previous_csrf.sql",
		]);
	});
});
