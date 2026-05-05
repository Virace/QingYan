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

function inferAppliedMigrations(sqlite: SqliteClient): string[] {
	if (!tableExists(sqlite, "sites")) {
		return [];
	}

	return ["0000_initial.sql"];
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
