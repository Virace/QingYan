import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createUpgradeBackups } from "../../src/modules/upgrade/backup";
import type { UpgradePlan } from "../../src/modules/upgrade/upgrade-plan";

describe("upgrade backup", () => {
	it("backs up config, sqlite files, and public upgrade plan", () => {
		const directory = mkdtempSync(
			path.join(tmpdir(), "qingyan-upgrade-backup-"),
		);
		try {
			const configPath = path.join(directory, "qingyan.yml");
			const databaseFile = path.join(directory, "qingyan.db");
			const backupDirectory = path.join(directory, "backup");
			writeFileSync(configPath, "database: {}\n", "utf-8");
			writeFileSync(databaseFile, "db", "utf-8");
			writeFileSync(`${databaseFile}-wal`, "wal", "utf-8");
			writeFileSync(`${databaseFile}-shm`, "shm", "utf-8");

			const plan: UpgradePlan = {
				currentVersion: "0.0.1",
				targetVersion: "0.1.0",
				schemaMigrations: [],
				applicationUpgrades: [],
				configChanges: [
					{
						path: "mail.smtp.password",
						action: "move",
						before: "raw-password",
						valueKind: "secret",
					},
				],
				dbSettingChanges: [],
				secretHandling: [],
				backupPaths: {},
				risks: [],
			};

			const backups = createUpgradeBackups({
				configPath,
				databaseFile,
				plan,
				backupDirectory,
				now: new Date("2026-05-06T00:00:00.000Z"),
			});

			expect(backups.config && existsSync(backups.config)).toBe(true);
			expect(backups.database && existsSync(backups.database)).toBe(true);
			expect(backups.sqliteWal && existsSync(backups.sqliteWal)).toBe(true);
			expect(backups.sqliteShm && existsSync(backups.sqliteShm)).toBe(true);
			expect(backups.plan && existsSync(backups.plan)).toBe(true);
			const planText = readFileSync(backups.plan ?? "", "utf-8");
			expect(planText).not.toContain("raw-password");
			expect(planText).toContain("[redacted]");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
