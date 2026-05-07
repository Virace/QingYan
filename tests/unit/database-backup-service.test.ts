import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import type { SqliteClient } from "../../src/db/client";
import { DatabaseBackupService } from "../../src/modules/database-backup/database-backup-service";

function createWorkspace() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-backup-"));
	const databaseFile = path.join(directory, "qingyan.db");
	const sqlite = new Database(databaseFile);
	sqlite.pragma("journal_mode = WAL");
	sqlite.exec("CREATE TABLE sample (id integer primary key, name text)");
	sqlite.prepare("INSERT INTO sample (name) VALUES (?)").run("before-import");

	return {
		directory,
		databaseFile,
		sqlite,
		cleanup() {
			sqlite.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

describe("DatabaseBackupService", () => {
	it("creates a SQLite import backup with engine and strategy metadata", async () => {
		const workspace = createWorkspace();

		try {
			const service = new DatabaseBackupService({
				engine: "sqlite",
				databaseFile: workspace.databaseFile,
				sqlite: workspace.sqlite,
				now: () => new Date("2026-05-07T00:00:00.000Z"),
			});

			const backup = await service.createImportBackup({
				jobId: "job_1",
				siteId: 1,
				sourceType: "wordpress-wxr",
			});

			expect(backup).toMatchObject({
				kind: "import_database_backup",
				engine: "sqlite",
				strategy: "sqlite_backup_api",
			});
			expect(existsSync(backup.databaseBackupPath)).toBe(true);
			expect(backup.files.map((file) => file.role)).toEqual(
				expect.arrayContaining(["database", "wal", "shm", "metadata"]),
			);
			expect(
				backup.files.find((file) => file.role === "database"),
			).toMatchObject({
				present: true,
			});
			expect(
				backup.files.find((file) => file.role === "metadata"),
			).toMatchObject({
				present: true,
			});
		} finally {
			workspace.cleanup();
		}
	});

	it("rejects unsupported database engines with an explicit error", async () => {
		const service = new DatabaseBackupService({
			engine: "postgres",
			databaseFile: "unused.db",
			sqlite: {} as SqliteClient,
		});

		await expect(
			service.createImportBackup({
				jobId: "job_1",
				siteId: 1,
				sourceType: "wordpress-wxr",
			}),
		).rejects.toThrow("DATABASE_BACKUP_ENGINE_UNSUPPORTED");
	});
});
