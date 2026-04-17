import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { applyInitialMigration } from "../support/test-fixtures";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
					"audit_logs",
				]),
			);
		} finally {
			fixture.cleanup();
		}
	});

	it("keeps runtime settings unique per site and avoids provider fields", () => {
		const fixture = createMigratedDatabase();
		const initialMigrationSql = readFileSync(
			path.resolve(process.cwd(), "drizzle/0000_initial.sql"),
			"utf-8",
		);

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
			expect(initialMigrationSql).not.toContain("provider_");
			expect(initialMigrationSql).not.toContain("artalk_");
			expect(initialMigrationSql).not.toContain("wp_");
			expect(initialMigrationSql).toContain("`captcha_mode` text");
			expect(initialMigrationSql).toContain(
				"`captcha_threshold_window_sec` integer",
			);
			expect(initialMigrationSql).toContain(
				"`captcha_threshold_max_actions` integer",
			);
			expect(initialMigrationSql).toContain("`abuse_guard_enabled` integer");
			expect(initialMigrationSql).toContain("`abuse_guard_window_sec` integer");
			expect(initialMigrationSql).toContain(
				"`abuse_guard_max_write_actions` integer",
			);
			expect(initialMigrationSql).toContain("`auto_blacklist_enabled` integer");
			expect(initialMigrationSql).toContain("`auto_blacklist_scope` text");
			expect(initialMigrationSql).toContain("`auto_blacklist_ttl_sec` integer");
			expect(initialMigrationSql).toContain("`triggered_by` text NOT NULL");
			expect(initialMigrationSql).toContain("`scope` text");
			expect(initialMigrationSql).toContain("`match_mode` text");
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
			const captchaSessionColumns = fixture.sqlite
				.prepare("PRAGMA table_info(captcha_sessions)")
				.all() as Array<{ name: string; dflt_value: string | null }>;
			const blacklistRuleColumns = fixture.sqlite
				.prepare("PRAGMA table_info(blacklist_rules)")
				.all() as Array<{ name: string; dflt_value: string | null }>;

			expect(runtimeSettingsColumns.map((column) => column.name)).toEqual(
				expect.arrayContaining([
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
				runtimeSettingsColumns.find((column) => column.name === "captcha_mode")
					?.dflt_value,
			).toBe("'threshold'");
			expect(captchaSessionColumns.map((column) => column.name)).toContain(
				"triggered_by",
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
