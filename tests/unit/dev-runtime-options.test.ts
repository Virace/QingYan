import { describe, expect, it } from "vitest";

import { resolveRuntimeOptions } from "../../src/config/runtime-options";
import { createTestConfig } from "../support/test-fixtures";

describe("resolveRuntimeOptions", () => {
	it("replaces configured sites with a single default site in dev mode", () => {
		const config = createTestConfig("./data/test.db");

		const resolved = resolveRuntimeOptions(config, {
			QINGYAN_DEV_MODE: "true",
			QINGYAN_DEV_ADMIN_TOKEN: "dev-token",
			QINGYAN_DEV_ALLOWED_ORIGIN: "http://localhost:4321",
		});

		expect(resolved.runtimeOptions.devMode).toEqual({
			enabled: true,
			adminToken: "dev-token",
			tokenSource: "env",
		});
		expect(resolved.config.sites).toHaveLength(1);
		expect(resolved.config.sites[0]).toMatchObject({
			siteKey: "default",
			name: "Default",
			allowedOrigins: ["http://localhost:4321"],
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
});
