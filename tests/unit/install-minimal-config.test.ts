import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveMinimalInstallConfig } from "../../src/modules/install/minimal-config";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

function createConfigPath() {
	const directory = mkdtempSync(join(tmpdir(), "qingyan-install-config-"));
	cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
	return join(directory, "config", "qingyan.yml");
}

describe("resolveMinimalInstallConfig", () => {
	it("defaults install restart mode to manual", () => {
		const configPath = createConfigPath();

		const config = resolveMinimalInstallConfig({
			QINGYAN_CONFIG_PATH: configPath,
		});

		expect(config.restartMode).toBe("manual");
	});

	it("resolves install restart mode from environment", () => {
		const configPath = createConfigPath();

		const config = resolveMinimalInstallConfig({
			QINGYAN_CONFIG_PATH: configPath,
			QINGYAN_INSTALL_RESTART_MODE: "exit",
		});

		expect(config.restartMode).toBe("exit");
	});

	it("rejects invalid install restart mode", () => {
		const configPath = createConfigPath();

		expect(() =>
			resolveMinimalInstallConfig({
				QINGYAN_CONFIG_PATH: configPath,
				QINGYAN_INSTALL_RESTART_MODE: "reload",
			}),
		).toThrow("QINGYAN_INSTALL_RESTART_MODE");
	});
});
