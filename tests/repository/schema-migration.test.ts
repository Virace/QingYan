import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { applyInitialMigration } from "../support/test-fixtures";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
			expect(
				blacklistRuleColumns.find((column) => column.name === "scope")
					?.dflt_value,
			).toBe("'post'");
		} finally {
			fixture.cleanup();
		}
	});
});
