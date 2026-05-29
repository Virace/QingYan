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
	it("defaults install transition mode to reload_in_process", () => {
		const configPath = createConfigPath();

		const config = resolveMinimalInstallConfig({
			QINGYAN_CONFIG_PATH: configPath,
		});

		expect(config.transitionMode).toBe("reload_in_process");
	});

	it("resolves install transition mode from environment", () => {
		const configPath = createConfigPath();

		const config = resolveMinimalInstallConfig({
			QINGYAN_CONFIG_PATH: configPath,
			QINGYAN_INSTALL_TRANSITION_MODE: "exit_for_supervisor",
		});

		expect(config.transitionMode).toBe("exit_for_supervisor");
	});

	it("ignores removed install restart mode environment", () => {
		const configPath = createConfigPath();

		const config = resolveMinimalInstallConfig({
			QINGYAN_CONFIG_PATH: configPath,
			QINGYAN_INSTALL_RESTART_MODE: "exit",
		});

		expect(config.transitionMode).toBe("reload_in_process");
	});

	it("rejects invalid install transition mode", () => {
		const configPath = createConfigPath();

		expect(() =>
			resolveMinimalInstallConfig({
				QINGYAN_CONFIG_PATH: configPath,
				QINGYAN_INSTALL_TRANSITION_MODE: "restart_api",
			}),
		).toThrow("QINGYAN_INSTALL_TRANSITION_MODE");
	});
});
