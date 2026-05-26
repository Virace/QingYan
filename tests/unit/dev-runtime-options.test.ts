import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveRuntimeOptions } from "../../src/config/runtime-options";
import { applyInstall } from "../../src/modules/install/install-service";
import type { MinimalInstallConfig } from "../../src/modules/install/minimal-config";
import { createTestConfig } from "../support/test-fixtures";

async function createInstalledDevWorkspace(adminConsolePath = "/admin") {
	const directory = mkdtempSync(join(tmpdir(), "qingyan-dev-installed-"));
	const databaseFile = join(directory, "data", "qingyan.db");
	const configPath = join(directory, "config", "qingyan.yml");
	const minimalConfig: MinimalInstallConfig = {
		configPath,
		host: "127.0.0.1",
		port: 4401,
		publicPath: "/qingyan",
		token: "install-token",
		disabled: false,
		restartMode: "manual",
		transitionMode: "manual",
	};
	await applyInstall({
		minimalConfig,
		payload: {
			token: "install-token",
			server: {
				host: "127.0.0.1",
				port: 4401,
				publicBaseUrl: "http://localhost:4401",
				publicPath: "/qingyan",
				trustProxy: false,
			},
			database: {
				sqliteFile: databaseFile,
			},
			admin: {
				consolePath: adminConsolePath,
				username: "admin",
				password: "adminadmin",
			},
			site: {
				siteKey: "default",
				name: "Default",
				allowedOrigins: ["http://localhost:4321"],
			},
		},
		environment: {},
	});

	return { directory, configPath };
}

describe("resolveRuntimeOptions", () => {
	it("keeps config untouched and exposes an explicit dev seed in dev mode", () => {
		const config = createTestConfig("./data/test.db");

		const resolved = resolveRuntimeOptions(config, {
			QINGYAN_DEV_MODE: "true",
			QINGYAN_DEV_ADMIN_TOKEN: "dev-token",
			QINGYAN_DEV_ALLOWED_ORIGIN: "http://localhost:4321",
		});

		expect(resolved.runtimeOptions.devMode).toEqual({
			enabled: true,
			adminUsername: "admin",
			adminPassword: "admin",
			adminToken: "dev-token",
			tokenSource: "env",
			seed: {
				site: {
					siteKey: "default",
					name: "Default",
					allowedOrigins: ["http://localhost:4321"],
				},
			},
		});
		expect(resolved.config).toBe(config);
		expect("sites" in resolved.config).toBe(false);
	});

	it("does not derive the dev seed from startup config sites", () => {
		const config = createTestConfig("./data/test.db");

		const resolved = resolveRuntimeOptions(config, {
			QINGYAN_DEV_MODE: "true",
			QINGYAN_DEV_ALLOWED_ORIGIN: "http://localhost:5173",
		});

		expect(resolved.runtimeOptions.devMode.seed?.site).toEqual({
			siteKey: "default",
			name: "Default",
			allowedOrigins: ["http://localhost:5173"],
		});
	});

	it("allows overriding fixed dev admin credentials", () => {
		const config = createTestConfig("./data/test.db");

		const resolved = resolveRuntimeOptions(config, {
			QINGYAN_DEV_MODE: "true",
			QINGYAN_DEV_ADMIN_USERNAME: "dev-admin",
			QINGYAN_DEV_ADMIN_PASSWORD: "dev-password",
		});

		expect(resolved.runtimeOptions.devMode).toMatchObject({
			enabled: true,
			adminUsername: "dev-admin",
			adminPassword: "dev-password",
		});
	});

	it("keeps the original sites untouched when dev mode is disabled", () => {
		const config = createTestConfig("./data/test.db");

		const resolved = resolveRuntimeOptions(config, {
			QINGYAN_DEV_MODE: "false",
		});

		expect(resolved.runtimeOptions.devMode.enabled).toBe(false);
		expect(resolved.config).toBe(config);
	});

	it("prints fixed dev credentials and captcha from the dev script", async () => {
		const workspace = await createInstalledDevWorkspace();
		try {
			const tsxCli = join(
				process.cwd(),
				"node_modules",
				"tsx",
				"dist",
				"cli.mjs",
			);
			const result = spawnSync(process.execPath, [tsxCli, "scripts/dev.ts"], {
				cwd: process.cwd(),
				env: {
					...process.env,
					QINGYAN_CONFIG_PATH: workspace.configPath,
					QINGYAN_DEV_CAPTCHA_ANSWER: "1357",
					QINGYAN_DEV_API_ORIGIN: "http://127.0.0.1:9",
					QINGYAN_DEV_PRINT_CONFIG_ONLY: "true",
					PATH: process.env.PATH ?? "",
				},
				encoding: "utf-8",
			});

			const output = `${result.stdout}\n${result.stderr}`;
			expect(output).toContain("QingYan Dev Admin: admin / admin");
			expect(output).toContain("QingYan Dev Captcha: 1357");
		} finally {
			rmSync(workspace.directory, { recursive: true, force: true });
		}
	});

	it("prints the dev-only /admin alias when the configured admin path differs", async () => {
		const workspace = await createInstalledDevWorkspace("/hidden-admin");
		try {
			const tsxCli = join(
				process.cwd(),
				"node_modules",
				"tsx",
				"dist",
				"cli.mjs",
			);
			const result = spawnSync(process.execPath, [tsxCli, "scripts/dev.ts"], {
				cwd: process.cwd(),
				env: {
					...process.env,
					QINGYAN_CONFIG_PATH: workspace.configPath,
					QINGYAN_DEV_API_ORIGIN: "http://127.0.0.1:9",
					QINGYAN_DEV_PRINT_CONFIG_ONLY: "true",
					PATH: process.env.PATH ?? "",
				},
				encoding: "utf-8",
			});

			const output = `${result.stdout}\n${result.stderr}`;
			expect(output).toContain(
				"QingYan Admin dev server: http://localhost:5173/qingyan/hidden-admin",
			);
			expect(output).toContain(
				"QingYan Admin dev alias: http://localhost:5173/qingyan/admin",
			);
			expect(output).not.toContain("QINGYAN_ADMIN_DEV_PATHS");
		} finally {
			rmSync(workspace.directory, { recursive: true, force: true });
		}
	});

	it("keeps the admin dev server disabled when the dev script is in install mode", () => {
		const workspace = mkdtempSync(join(tmpdir(), "qingyan-dev-install-"));
		try {
			const tsxCli = join(
				process.cwd(),
				"node_modules",
				"tsx",
				"dist",
				"cli.mjs",
			);
			const result = spawnSync(process.execPath, [tsxCli, "scripts/dev.ts"], {
				cwd: process.cwd(),
				env: {
					...process.env,
					QINGYAN_CONFIG_PATH: join(workspace, "config", "qingyan.yml"),
					QINGYAN_DEV_API_ORIGIN: "http://127.0.0.1:9",
					QINGYAN_DEV_PRINT_CONFIG_ONLY: "true",
					PATH: process.env.PATH ?? "",
				},
				encoding: "utf-8",
			});

			const output = `${result.stdout}\n${result.stderr}`;
			expect(output).toContain("QingYan install mode:");
			expect(output).toContain(
				"install.url=http://127.0.0.1:4401/qingyan/admin/install",
			);
			expect(output).not.toContain("QingYan Admin dev server:");
			expect(output).not.toContain("QingYan Dev Admin:");
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});
