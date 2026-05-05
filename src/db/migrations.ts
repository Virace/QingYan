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

function tableHasColumn(
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

	const applied = ["0000_initial.sql"];
	if (tableExists(sqlite, "system_settings")) {
		applied.push("0001_classy_ben_grimm.sql");
	}
	if (tableHasColumn(sqlite, "captcha_sessions", "provider_kind")) {
		applied.push("0002_public_captcha_providers.sql");
	}
	if (tableExists(sqlite, "ip_region_database_state")) {
		applied.push("0003_comment_request_metadata.sql");
	}
	if (tableExists(sqlite, "admin_bootstrap_state")) {
		applied.push("0004_admin_bootstrap_state.sql");
	}
	if (tableHasColumn(sqlite, "runtime_settings", "comment_metadata_json")) {
		applied.push("0005_runtime_settings_comment_metadata.sql");
	}
	if (tableExists(sqlite, "import_batches")) {
		applied.push("0006_import_jobs.sql");
	}

	return applied;
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
}
