import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config/load-config";
import { createDatabaseClients } from "../../src/db/client";
import {
	adminBootstrapState,
	siteSettings,
	sites,
	systemSettings,
} from "../../src/db/schema";
import { buildInstallApp } from "../../src/modules/install/install-app";
import type { MinimalInstallConfig } from "../../src/modules/install/minimal-config";
import { resolveInstallState } from "../../src/modules/install/state";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

function createWorkspace() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-install-"));
	const configPath = path.join(directory, "config", "qingyan.yml");
	const databaseFile = path.join(directory, "data", "qingyan.db");
	cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
	return {
		directory,
		configPath,
		databaseFile,
	};
}

function createMinimalConfig(configPath: string): MinimalInstallConfig {
	return {
		configPath,
		host: "127.0.0.1",
		port: 4401,
		token: "install-token",
		disabled: false,
	};
}

function installPayload(databaseFile: string, token = "install-token") {
	return {
		token,
		server: {
			host: "127.0.0.1",
			port: 4401,
			publicBaseUrl: "http://localhost:4401",
			trustProxy: false,
		},
		database: {
			sqliteFile: databaseFile,
		},
		admin: {
			consolePath: "/admin",
			username: "admin",
			password: "adminadmin",
		},
		site: {
			siteKey: "default",
			name: "Default",
			allowedOrigins: ["http://localhost:4321"],
		},
	};
}

describe("install bootstrap", () => {
	it("serves install page when config is missing", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const response = await app.inject({
			method: "GET",
			url: "/install?token=install-token",
		});

		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("QingYan Install");
	});

	it("rejects missing or invalid install tokens", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const state = await app.inject({
			method: "GET",
			url: "/api/install/state",
		});
		expect(state.statusCode).toBe(403);
		expect(state.json()).toMatchObject({
			error: {
				code: "INSTALL_TOKEN_INVALID",
			},
		});

		const apply = await app.inject({
			method: "POST",
			url: "/api/install/apply",
			payload: installPayload(workspace.databaseFile, "bad-token"),
		});
		expect(apply.statusCode).toBe(403);
		expect(apply.json()).toMatchObject({
			error: {
				code: "INSTALL_TOKEN_INVALID",
			},
		});
	});

	it("writes startup config and seeds the SQLite database", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		const response = await app.inject({
			method: "POST",
			url: "/api/install/apply",
			payload: installPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			adminUrl: "http://localhost:4401/admin",
			username: "admin",
			initialPassword: "adminadmin",
			configPath: workspace.configPath,
			databasePath: path.resolve(process.cwd(), workspace.databaseFile),
			restartRequired: true,
		});

		const config = await loadConfig(workspace.configPath, {});
		expect(config.database.sqlite.file).toBe(workspace.databaseFile);
		expect(config.server.publicBaseUrl).toBe("http://localhost:4401");

		const { db, sqlite } = createDatabaseClients(workspace.databaseFile);
		try {
			const [bootstrap] = await db.select().from(adminBootstrapState);
			expect(bootstrap).toMatchObject({
				consolePath: "/admin",
				username: "admin",
			});
			const [site] = await db
				.select()
				.from(sites)
				.where(eq(sites.siteKey, "default"));
			expect(site).toMatchObject({
				name: "Default",
			});
			const [settings] = await db
				.select()
				.from(siteSettings)
				.where(eq(siteSettings.siteId, site?.id ?? 0));
			expect(settings).toMatchObject({
				commentsEnabled: true,
				rootLimit: 20,
			});
			const loggingRows = await db
				.select()
				.from(systemSettings)
				.where(eq(systemSettings.category, "logging"));
			expect(loggingRows).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ key: "level", valueJson: '"info"' }),
					expect.objectContaining({ key: "retentionDays", valueJson: "7" }),
				]),
			);
		} finally {
			sqlite.close();
		}
	});

	it("resolves installed state after apply and blocks install page", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		await app.inject({
			method: "POST",
			url: "/api/install/apply",
			payload: installPayload(workspace.databaseFile),
		});

		await expect(resolveInstallState(minimalConfig, {})).resolves.toMatchObject(
			{
				installed: true,
			},
		);
		const response = await app.inject({
			method: "GET",
			url: "/install?token=install-token",
		});
		expect(response.statusCode).toBe(410);
	});
});
