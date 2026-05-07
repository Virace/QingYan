import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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

	it("creates a SQLite upgrade backup with config, plan, and metadata", async () => {
		const workspace = createWorkspace();

		try {
			const configPath = path.join(workspace.directory, "qingyan.yml");
			const partialMarkerPath = path.join(
				workspace.directory,
				"partial-upgrade.json",
			);
			writeFileSync(
				configPath,
				"database:\n  sqlite:\n    file: qingyan.db\n",
				"utf-8",
			);
			const service = new DatabaseBackupService({
				engine: "sqlite",
				databaseFile: workspace.databaseFile,
				sqlite: workspace.sqlite,
				now: () => new Date("2026-05-07T00:00:00.000Z"),
			});

			const backup = await service.createUpgradeBackup({
				upgradeId: "upgrade_20260507000000",
				fromVersion: "0.0.1",
				toVersion: "0.1.0",
				configPath,
				partialMarkerPath,
				plan: {
					currentVersion: "0.0.1",
					targetVersion: "0.1.0",
					configChanges: [
						{
							path: "mail.smtp.password",
							before: "[redacted]",
						},
					],
				},
			});

			expect(backup).toMatchObject({
				kind: "upgrade_database_backup",
				engine: "sqlite",
				strategy: "sqlite_backup_api",
			});
			expect(backup.backupDirectory).toContain("upgrade_20260507000000");
			expect(existsSync(backup.databaseBackupPath)).toBe(true);
			expect(backup.files.map((file) => file.role)).toEqual(
				expect.arrayContaining([
					"database",
					"wal",
					"shm",
					"config",
					"plan",
					"metadata",
				]),
			);

			const planFile = backup.files.find((file) => file.role === "plan");
			expect(planFile).toMatchObject({ present: true });
			const planText = readFileSync(planFile?.backupPath ?? "", "utf-8");
			expect(planText).toContain("[redacted]");
			expect(planText).not.toContain("raw-password");

			const metadataFile = backup.files.find(
				(file) => file.role === "metadata",
			);
			const metadata = JSON.parse(
				readFileSync(metadataFile?.backupPath ?? "", "utf-8"),
			) as unknown;
			expect(metadata).toMatchObject({
				kind: "upgrade_database_backup",
				input: {
					fromVersion: "0.0.1",
					toVersion: "0.1.0",
					partialMarkerPath,
				},
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
		await expect(
			service.createUpgradeBackup({
				upgradeId: "upgrade_1",
				fromVersion: "0.0.1",
				toVersion: "0.1.0",
				configPath: "config/qingyan.yml",
				partialMarkerPath: "data/upgrade/partial-upgrade.json",
				plan: {},
			}),
		).rejects.toThrow("DATABASE_BACKUP_ENGINE_UNSUPPORTED");
	});
});
