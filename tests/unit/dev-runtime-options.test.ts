import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveRuntimeOptions } from "../../src/config/runtime-options";
import { createTestConfig } from "../support/test-fixtures";

describe("resolveRuntimeOptions", () => {
	it("keeps config untouched and exposes a runtime-only default site in dev mode", () => {
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
			defaultSite: expect.objectContaining({
				siteKey: "default",
				name: "Default",
				allowedOrigins: ["http://localhost:4321"],
			}),
		});
		expect(resolved.config.sites).toHaveLength(1);
		expect(resolved.config.sites[0]).toMatchObject({
			siteKey: "fangyuan",
			name: "FangYuan",
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
		expect(resolved.config.sites[0]?.siteKey).toBe("fangyuan");
	});

	it("prints fixed dev credentials and captcha from the dev script", () => {
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
	});
});
