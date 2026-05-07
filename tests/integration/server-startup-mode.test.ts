import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";

import { resolveStartupMode } from "../../src/startup-mode";
import {
	applyInitialMigration,
	createTestConfig,
} from "../support/test-fixtures";
import { writePartialUpgradeMarker } from "../../src/modules/upgrade/partial-marker";

function createWorkspace() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-startup-mode-"));
	const databaseFile = path.join(directory, "qingyan.db");
	const configPath = path.join(directory, "qingyan.yml");
	const partialUpgradeMarkerPath = path.join(
		directory,
		"data",
		"upgrade",
		"partial-upgrade.json",
	);
	return {
		directory,
		databaseFile,
		configPath,
		partialUpgradeMarkerPath,
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

function markInstalled(databaseFile: string, version: string) {
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

async function resolve(
	workspace: ReturnType<typeof createWorkspace>,
	version: string,
) {
	return resolveStartupMode({
		installed: true,
		configPath: workspace.configPath,
		currentApplicationVersion: version,
		partialUpgradeMarkerPath: workspace.partialUpgradeMarkerPath,
		createSqliteClient: (file) => new Database(file),
	});
}

describe("startup mode resolver", () => {
	it("routes not-installed state to install mode", async () => {
		const workspace = createWorkspace();
		try {
			await expect(
				resolveStartupMode({
					installed: false,
					installReason: "config_missing",
					configPath: workspace.configPath,
					currentApplicationVersion: "0.1.0",
					partialUpgradeMarkerPath: workspace.partialUpgradeMarkerPath,
					createSqliteClient: (file) => new Database(file),
				}),
			).resolves.toMatchObject({ mode: "install" });
		} finally {
			workspace.cleanup();
		}
	});

	it("routes upgrade, recovery, broken config, and normal states", async () => {
		const upgrade = createWorkspace();
		const recovery = createWorkspace();
		const broken = createWorkspace();
		const normal = createWorkspace();
		try {
			writeConfig(upgrade.configPath, upgrade.databaseFile);
			markInstalled(upgrade.databaseFile, "0.0.1");
			await expect(resolve(upgrade, "0.1.0")).resolves.toMatchObject({
				mode: "upgrade",
				state: { state: "upgrade_required" },
			});

			writeConfig(recovery.configPath, recovery.databaseFile);
			markInstalled(recovery.databaseFile, "0.1.0");
			writePartialUpgradeMarker({
				markerPath: recovery.partialUpgradeMarkerPath,
				fromVersion: "0.0.1",
				toVersion: "0.1.0",
				planPath: "backup/upgrade-plan.json",
				backupDirectory: "backup",
				currentStep: "backup",
			});
			await expect(resolve(recovery, "0.1.0")).resolves.toMatchObject({
				mode: "upgrade",
				state: { state: "recovery_required" },
			});

			writeFileSync(broken.configPath, "bad: [", "utf-8");
			await expect(resolve(broken, "0.1.0")).resolves.toMatchObject({
				mode: "upgrade",
				state: { state: "broken_config" },
			});

			writeConfig(normal.configPath, normal.databaseFile);
			markInstalled(normal.databaseFile, "0.1.0");
			await expect(resolve(normal, "0.1.0")).resolves.toMatchObject({
				mode: "normal",
			});
		} finally {
			upgrade.cleanup();
			recovery.cleanup();
			broken.cleanup();
			normal.cleanup();
		}
	});
});
