import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { describe, expect, it, vi } from "vitest";

import {
	createTestConfig,
	applyV010BaselineMigration,
} from "../support/test-fixtures";
import { runUpgradeCli } from "../../scripts/upgrade";

function createWorkspace() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-upgrade-cli-"));
	const databaseFile = path.join(directory, "qingyan.db");
	const configPath = path.join(directory, "qingyan.yml");
	const backupDirectory = path.join(directory, "backup");
	return {
		directory,
		databaseFile,
		configPath,
		backupDirectory,
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
}

function seedOldDatabase(databaseFile: string) {
	applyV010BaselineMigration(databaseFile);
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

describe("upgrade cli", () => {
	it("rejects options without values", async () => {
		await expect(runUpgradeCli(["--dry-run", "--config"])).rejects.toThrow(
			"--config requires a value",
		);
		await expect(
			runUpgradeCli([
				"--apply",
				"--config",
				"config/qingyan.yml",
				"--backup-dir",
			]),
		).rejects.toThrow("--backup-dir requires a value");
	});

	it("prints dry-run plan without writing the upgrade ledger", async () => {
		const workspace = createWorkspace();
		const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
		try {
			writeConfig(workspace.configPath, workspace.databaseFile);
			seedOldDatabase(workspace.databaseFile);

			const exitCode = await runUpgradeCli([
				"--dry-run",
				"--config",
				workspace.configPath,
			]);

			expect(exitCode).toBe(0);
			expect(output).toHaveBeenCalledOnce();
			expect(output.mock.calls[0]?.[0]).toContain("application-version:0.2.2");
			expect(readUpgradeRows(workspace.databaseFile)).toEqual([
				{ name: "application-version:0.0.1", to_version: "0.0.1" },
			]);
		} finally {
			output.mockRestore();
			workspace.cleanup();
		}
	});

	it("requires backup directory before apply writes the upgrade ledger", async () => {
		const workspace = createWorkspace();
		const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
		try {
			writeConfig(workspace.configPath, workspace.databaseFile);
			seedOldDatabase(workspace.databaseFile);

			await expect(
				runUpgradeCli(["--apply", "--config", workspace.configPath]),
			).rejects.toThrow("--apply requires --backup-dir");
			const exitCode = await runUpgradeCli([
				"--apply",
				"--config",
				workspace.configPath,
				"--backup-dir",
				workspace.backupDirectory,
			]);

			expect(exitCode).toBe(0);
			expect(readUpgradeRows(workspace.databaseFile)).toEqual([
				{ name: "application-version:0.0.1", to_version: "0.0.1" },
				{ name: "application-version:0.2.2", to_version: "0.2.2" },
			]);
			const result = JSON.parse(output.mock.calls.at(-1)?.[0] ?? "{}") as {
				backup?: {
					files?: Array<{ role: string; backupPath: string | null }>;
				};
			};
			const backupPath = (role: string) =>
				result.backup?.files?.find((file) => file.role === role)?.backupPath ??
				"";
			expect(existsSync(backupPath("config"))).toBe(true);
			expect(existsSync(backupPath("database"))).toBe(true);
			expect(existsSync(backupPath("plan"))).toBe(true);
		} finally {
			output.mockRestore();
			workspace.cleanup();
		}
	});
});
