import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";

import { createUpgradeApp } from "../../src/modules/upgrade/upgrade-app";
import {
	applyInitialMigration,
	createTestConfig,
} from "../support/test-fixtures";

function createWorkspace() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-upgrade-app-"));
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

function buildUpgradeFixture(options?: { currentVersion?: string }) {
	const workspace = createWorkspace();
	const loadedConfig = writeConfig(
		workspace.configPath,
		workspace.databaseFile,
	);
	seedOldDatabase(workspace.databaseFile);
	const app = createUpgradeApp({
		configPath: workspace.configPath,
		loadedConfig,
		databaseFile: workspace.databaseFile,
		currentApplicationVersion: options?.currentVersion ?? "0.1.0",
		partialUpgradeMarkerPath: workspace.partialUpgradeMarkerPath,
		token: "upgrade-token",
		createSqliteClient: (file) => new Database(file),
		now: () => new Date("2026-05-07T00:00:00.000Z"),
	});
	return {
		app,
		workspace,
		async cleanup() {
			await app.close();
			workspace.cleanup();
		},
	};
}

describe("upgrade app", () => {
	it("serves upgrade page and state without registering normal admin APIs", async () => {
		const fixture = buildUpgradeFixture();
		try {
			const page = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/upgrade",
			});
			expect(page.statusCode).toBe(200);
			expect(page.headers["set-cookie"]).toBeUndefined();
			expect(page.body).toContain("QingYan Upgrade");
			expect(page.body).toContain('id="token"');
			expect(page.body).toContain('autocomplete="one-time-code"');
			expect(page.body).toContain("token: tokenInput.value");

			const state = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/api/upgrade/state",
			});
			expect(state.json()).toMatchObject({
				state: "upgrade_required",
				plan: {
					targetVersion: "0.1.0",
				},
			});

			const admin = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/api/admin/session/me",
			});
			expect(admin.statusCode).toBe(404);
		} finally {
			await fixture.cleanup();
		}
	});

	it("requires upgrade token and exact confirmation before apply", async () => {
		const fixture = buildUpgradeFixture();
		try {
			const missingToken = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/upgrade/apply",
				payload: { confirm: "UPGRADE QINGYAN" },
			});
			expect(missingToken.statusCode).toBe(403);
			expect(missingToken.json().error.code).toBe("UPGRADE_TOKEN_INVALID");

			const cookieOnly = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/upgrade/apply",
				headers: { cookie: "qingyan_upgrade=upgrade-token" },
				payload: { confirm: "UPGRADE QINGYAN" },
			});
			expect(cookieOnly.statusCode).toBe(403);
			expect(cookieOnly.json().error.code).toBe("UPGRADE_TOKEN_INVALID");

			const badConfirm = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/upgrade/apply",
				payload: { token: "upgrade-token", confirm: "upgrade" },
			});
			expect(badConfirm.statusCode).toBe(400);
			expect(badConfirm.json().error.code).toBe("INVALID_REQUEST");
		} finally {
			await fixture.cleanup();
		}
	});

	it("applies upgrade when token and confirmation are valid", async () => {
		const fixture = buildUpgradeFixture();
		try {
			const response = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/upgrade/apply",
				payload: { token: "upgrade-token", confirm: "UPGRADE QINGYAN" },
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				state: "applied",
				restartRequired: true,
			});
		} finally {
			await fixture.cleanup();
		}
	});

	it("rejects apply when state is already normal", async () => {
		const fixture = buildUpgradeFixture({ currentVersion: "0.0.1" });
		try {
			const response = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/upgrade/apply",
				payload: { token: "upgrade-token", confirm: "UPGRADE QINGYAN" },
			});

			expect(response.statusCode).toBe(409);
			expect(response.json().error.code).toBe("UPGRADE_STATE_INVALID");
		} finally {
			await fixture.cleanup();
		}
	});

	it("renders broken config state", async () => {
		const workspace = createWorkspace();
		const app = createUpgradeApp({
			configPath: workspace.configPath,
			configError: new Error("database.sqlite.file is required"),
			databaseFile: workspace.databaseFile,
			currentApplicationVersion: "0.1.0",
			partialUpgradeMarkerPath: workspace.partialUpgradeMarkerPath,
			token: "upgrade-token",
			createSqliteClient: (file) => new Database(file),
		});
		try {
			const state = await app.inject({
				method: "GET",
				url: "/qingyan/api/upgrade/state",
			});
			expect(state.json()).toMatchObject({
				state: "broken_config",
				reason: "database.sqlite.file is required",
			});
			const page = await app.inject({ method: "GET", url: "/qingyan/upgrade" });
			expect(page.body).toContain("broken_config");
		} finally {
			await app.close();
			workspace.cleanup();
		}
	});
});
