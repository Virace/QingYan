import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { detectUpgradeRuntimeState } from "../../src/modules/upgrade/state";
import {
	createTestConfig,
	applyInitialMigration,
} from "../support/test-fixtures";

function createWorkspace() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-upgrade-state-"));
	const databaseFile = path.join(directory, "qingyan.db");
	const configPath = path.join(directory, "qingyan.yml");
	return {
		directory,
		databaseFile,
		configPath,
		cleanup() {
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

function markCurrentDatabase(databaseFile: string, version: string) {
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
			.run(`application-version:${version}`, version, "{}");
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

describe("upgrade runtime state", () => {
	it("classifies missing config as install state", () => {
		const workspace = createWorkspace();
		try {
			const state = detectUpgradeRuntimeState({
				configPath: workspace.configPath,
				databaseFile: workspace.databaseFile,
				createSqliteClient: (file) => new Database(file),
				currentApplicationVersion: "0.1.0",
			});

			expect(existsSync(workspace.configPath)).toBe(false);
			expect(state).toEqual({ state: "not_installed" });
		} finally {
			workspace.cleanup();
		}
	});

	it("classifies current config and database as normal", () => {
		const workspace = createWorkspace();
		try {
			applyInitialMigration(workspace.databaseFile);
			markCurrentDatabase(workspace.databaseFile, "0.1.0");
			writeFileSync(workspace.configPath, "server:\n", "utf-8");

			const state = detectUpgradeRuntimeState({
				configPath: workspace.configPath,
				loadedConfig: createTestConfig(workspace.databaseFile),
				databaseFile: workspace.databaseFile,
				createSqliteClient: (file) => new Database(file),
				currentApplicationVersion: "0.1.0",
			});

			expect(state).toEqual({ state: "normal_current" });
		} finally {
			workspace.cleanup();
		}
	});

	it("classifies old application upgrade ledger as upgrade required", () => {
		const workspace = createWorkspace();
		try {
			applyInitialMigration(workspace.databaseFile);
			markCurrentDatabase(workspace.databaseFile, "0.0.1");
			writeFileSync(workspace.configPath, "server:\n", "utf-8");

			const state = detectUpgradeRuntimeState({
				configPath: workspace.configPath,
				loadedConfig: createTestConfig(workspace.databaseFile),
				databaseFile: workspace.databaseFile,
				createSqliteClient: (file) => new Database(file),
				currentApplicationVersion: "0.1.0",
			});

			expect(state.state).toBe("upgrade_required");
			expect(state).toMatchObject({
				plan: {
					targetVersion: "0.1.0",
					applicationUpgrades: [
						{
							name: "application-version:0.1.0",
							fromVersion: "0.0.1",
							toVersion: "0.1.0",
						},
					],
				},
			});
		} finally {
			workspace.cleanup();
		}
	});

	it("classifies missing schema migration ledger as schema upgrade required", () => {
		const workspace = createWorkspace();
		try {
			applyInitialMigration(workspace.databaseFile);
			writeFileSync(workspace.configPath, "server:\n", "utf-8");

			const state = detectUpgradeRuntimeState({
				configPath: workspace.configPath,
				loadedConfig: createTestConfig(workspace.databaseFile),
				databaseFile: workspace.databaseFile,
				createSqliteClient: (file) => new Database(file),
				currentApplicationVersion: "0.1.0",
			});

			expect(state.state).toBe("upgrade_required");
			expect(state).toMatchObject({
				plan: {
					schemaMigrations: [
						{
							name: "schema-migration-ledger",
							description: "Create migration ledger",
						},
					],
					applicationUpgrades: [],
				},
			});
		} finally {
			workspace.cleanup();
		}
	});

	it("classifies partial upgrade marker as recovery required", () => {
		const workspace = createWorkspace();
		try {
			const markerPath = path.join(workspace.directory, "partial-upgrade.json");
			writeFileSync(workspace.configPath, "server:\n", "utf-8");
			writeFileSync(markerPath, "{}", "utf-8");

			const state = detectUpgradeRuntimeState({
				configPath: workspace.configPath,
				loadedConfig: createTestConfig(workspace.databaseFile),
				databaseFile: workspace.databaseFile,
				createSqliteClient: (file) => new Database(file),
				currentApplicationVersion: "0.1.0",
				partialUpgradeMarkerPath: markerPath,
			});

			expect(state).toEqual({
				state: "recovery_required",
				reason: "partial_upgrade_marker",
			});
		} finally {
			workspace.cleanup();
		}
	});
});
