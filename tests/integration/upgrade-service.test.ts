import Database from "better-sqlite3";
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
import { stringify } from "yaml";

import { createDatabaseClients } from "../../src/db/client";
import {
	type RegisteredApplicationUpgrade,
	UpgradeService,
} from "../../src/modules/upgrade/upgrade-service";
import {
	applyInitialMigration,
	createTestConfig,
} from "../support/test-fixtures";

function createWorkspace() {
	const directory = mkdtempSync(
		path.join(tmpdir(), "qingyan-upgrade-service-"),
	);
	const databaseFile = path.join(directory, "qingyan.db");
	const configPath = path.join(directory, "qingyan.yml");
	const partialMarkerPath = path.join(
		directory,
		"data",
		"upgrade",
		"partial-upgrade.json",
	);
	return {
		directory,
		databaseFile,
		configPath,
		partialMarkerPath,
		cleanup() {
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

function writeConfig(configPath: string, databaseFile: string) {
	const config = createTestConfig(
		databaseFile,
		path.join(path.dirname(configPath), "logs"),
	);
	writeFileSync(
		configPath,
		stringify({
			server: config.server,
			database: config.database,
			admin: {
				session: config.admin.session,
			},
			security: config.security,
		}),
		"utf-8",
	);
	return config;
}

function seedOldDatabase(databaseFile: string) {
	applyInitialMigration(databaseFile);
	const sqlite = new Database(databaseFile);
	try {
		sqlite.exec(`
			CREATE TABLE IF NOT EXISTS __qingyan_migrations (
				name text PRIMARY KEY NOT NULL,
				applied_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
			)
		`);
		sqlite
			.prepare("INSERT INTO __qingyan_migrations (name) VALUES (?)")
			.run("0000_initial.sql");
		sqlite
			.prepare(
				"INSERT INTO __qingyan_upgrades (name, to_version, summary_json) VALUES (?, ?, ?)",
			)
			.run("application-version:0.0.1", "0.0.1", "{}");
		sqlite
			.prepare(
				"INSERT INTO sites (site_key, name, allowed_origins_json) VALUES (?, ?, ?)",
			)
			.run("default", "Default", "[]");
		sqlite
			.prepare(
				"INSERT INTO admin_bootstrap_state (id, console_path, username, password_hash) VALUES (?, ?, ?, ?)",
			)
			.run(1, "/admin", "admin", "hash");
	} finally {
		sqlite.close();
	}
}

function readUpgradeRows(databaseFile: string) {
	const sqlite = new Database(databaseFile);
	try {
		return sqlite
			.prepare("SELECT name, to_version FROM __qingyan_upgrades ORDER BY name")
			.all() as Array<{ name: string; to_version: string }>;
	} finally {
		sqlite.close();
	}
}

describe("UpgradeService", () => {
	it("creates backup before writing upgrade ledger and clears marker on success", async () => {
		const workspace = createWorkspace();
		try {
			const loadedConfig = writeConfig(
				workspace.configPath,
				workspace.databaseFile,
			);
			seedOldDatabase(workspace.databaseFile);
			const service = new UpgradeService({
				configPath: workspace.configPath,
				loadedConfig,
				databaseFile: workspace.databaseFile,
				currentApplicationVersion: "0.1.0",
				partialUpgradeMarkerPath: workspace.partialMarkerPath,
				createSqliteClient: (file) => new Database(file),
				now: () => new Date("2026-05-07T00:00:00.000Z"),
			});

			const result = await service.apply({ confirm: "UPGRADE QINGYAN" });

			expect(result).toMatchObject({
				state: "applied",
				restartRequired: true,
				applied: {
					applicationUpgrades: ["application-version:0.1.0"],
				},
			});
			expect(existsSync(result.backup.backupDirectory)).toBe(true);
			expect(existsSync(workspace.partialMarkerPath)).toBe(false);
			expect(readUpgradeRows(workspace.databaseFile)).toEqual([
				{ name: "application-version:0.0.1", to_version: "0.0.1" },
				{ name: "application-version:0.1.0", to_version: "0.1.0" },
			]);
		} finally {
			workspace.cleanup();
		}
	});

	it("does not write ledger when backup fails", async () => {
		const workspace = createWorkspace();
		try {
			const loadedConfig = writeConfig(
				workspace.configPath,
				workspace.databaseFile,
			);
			seedOldDatabase(workspace.databaseFile);
			const service = new UpgradeService({
				configPath: workspace.configPath,
				loadedConfig,
				databaseFile: workspace.databaseFile,
				currentApplicationVersion: "0.1.0",
				partialUpgradeMarkerPath: workspace.partialMarkerPath,
				createSqliteClient: (file) => new Database(file),
				backupDirectory: workspace.databaseFile,
			});

			await expect(
				service.apply({ confirm: "UPGRADE QINGYAN" }),
			).rejects.toThrow();
			expect(readUpgradeRows(workspace.databaseFile)).toEqual([
				{ name: "application-version:0.0.1", to_version: "0.0.1" },
			]);
			expect(existsSync(workspace.partialMarkerPath)).toBe(true);
			expect(readFileSync(workspace.partialMarkerPath, "utf-8")).toContain(
				"backup",
			);
		} finally {
			workspace.cleanup();
		}
	});

	it("keeps partial marker when application upgrade fails", async () => {
		const workspace = createWorkspace();
		try {
			const loadedConfig = writeConfig(
				workspace.configPath,
				workspace.databaseFile,
			);
			seedOldDatabase(workspace.databaseFile);
			const failingStep: RegisteredApplicationUpgrade = {
				name: "failing-step",
				toVersion: "0.1.0",
				describe: () => ({ name: "failing-step", toVersion: "0.1.0" }),
				apply: () => {
					throw new Error("step failed");
				},
			};
			const service = new UpgradeService({
				configPath: workspace.configPath,
				loadedConfig,
				databaseFile: workspace.databaseFile,
				currentApplicationVersion: "0.1.0",
				partialUpgradeMarkerPath: workspace.partialMarkerPath,
				createSqliteClient: (file) => new Database(file),
				registeredApplicationUpgrades: [failingStep],
			});

			await expect(
				service.apply({ confirm: "UPGRADE QINGYAN" }),
			).rejects.toThrow("step failed");
			expect(existsSync(workspace.partialMarkerPath)).toBe(true);
			expect(readFileSync(workspace.partialMarkerPath, "utf-8")).toContain(
				"application-upgrades",
			);
		} finally {
			workspace.cleanup();
		}
	});

	it("runs registered application upgrades before writing ledger", async () => {
		const workspace = createWorkspace();
		try {
			const loadedConfig = writeConfig(
				workspace.configPath,
				workspace.databaseFile,
			);
			seedOldDatabase(workspace.databaseFile);
			const step: RegisteredApplicationUpgrade = {
				name: "service-probe",
				fromVersion: "0.0.1",
				toVersion: "0.1.0",
				describe: () => ({
					name: "service-probe",
					fromVersion: "0.0.1",
					toVersion: "0.1.0",
				}),
				apply: ({ sqlite }) => {
					sqlite.exec(
						"CREATE TABLE service_upgrade_probe (id integer primary key)",
					);
				},
			};
			const service = new UpgradeService({
				configPath: workspace.configPath,
				loadedConfig,
				databaseFile: workspace.databaseFile,
				currentApplicationVersion: "0.1.0",
				partialUpgradeMarkerPath: workspace.partialMarkerPath,
				createSqliteClient: (file) => new Database(file),
				registeredApplicationUpgrades: [step],
			});

			const result = await service.apply({ confirm: "UPGRADE QINGYAN" });
			const { sqlite } = createDatabaseClients(workspace.databaseFile);
			try {
				expect(
					sqlite
						.prepare(
							"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
						)
						.get("service_upgrade_probe"),
				).toBeTruthy();
			} finally {
				sqlite.close();
			}
			expect(result.applied.applicationUpgrades).toEqual([
				"application-version:0.1.0",
				"service-probe",
			]);
		} finally {
			workspace.cleanup();
		}
	});
});
