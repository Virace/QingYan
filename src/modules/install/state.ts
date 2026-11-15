import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/load-config";
import { detectUpgradeRuntimeState } from "../upgrade/state";

import type { MinimalInstallConfig } from "./minimal-config";

export interface InstallState {
	installed: boolean;
	configPath: string;
	lockPath: string;
	reason?:
		| "config_missing"
		| "config_invalid"
		| "database_uninitialized"
		| "lock_missing";
	errorMessage?: string;
}

export function resolveInstallLockPath(configPath: string): string {
	return path.join(path.dirname(configPath), "qingyan.installed.lock");
}

export async function writeInstallLock(input: {
	configPath: string;
	databasePath: string;
	adminConsolePath: string;
}): Promise<string> {
	const lockPath = resolveInstallLockPath(input.configPath);
	await mkdir(path.dirname(lockPath), { recursive: true });
	const payload = {
		installedAt: new Date().toISOString(),
		configPath: input.configPath,
		databasePath: input.databasePath,
		adminConsolePath: input.adminConsolePath,
	};
	const tmpPath = `${lockPath}.${Date.now()}.tmp`;
	await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
	await rename(tmpPath, lockPath);
	return lockPath;
}

export async function resolveInstallState(
	minimalConfig: MinimalInstallConfig,
	_environment: NodeJS.ProcessEnv = process.env,
): Promise<InstallState> {
	const lockPath = resolveInstallLockPath(minimalConfig.configPath);
	if (existsSync(lockPath)) {
		return {
			installed: true,
			configPath: minimalConfig.configPath,
			lockPath,
		};
	}

	if (
		existsSync(
			path.resolve(
				path.dirname(minimalConfig.configPath),
				"../data/upgrade/partial-upgrade.json",
			),
		)
	)
		return { installed: true, configPath: minimalConfig.configPath, lockPath };

	if (!existsSync(minimalConfig.configPath)) {
		return {
			installed: false,
			configPath: minimalConfig.configPath,
			lockPath,
			reason: "config_missing",
		};
	}

	let loadedConfig: Awaited<ReturnType<typeof loadConfig>> | undefined;
	let configError: unknown;
	try {
		loadedConfig = await loadConfig(minimalConfig.configPath, _environment);
	} catch (error) {
		configError = error;
	}
	const state = await detectUpgradeRuntimeState({
		configPath: minimalConfig.configPath,
		loadedConfig,
		configError,
		currentApplicationVersion: "0.0.0",
		partialUpgradeMarkerPath: path.resolve(
			path.dirname(minimalConfig.configPath),
			"../data/upgrade/partial-upgrade.json",
		),
	});
	return {
		installed: state.state !== "not_installed",
		configPath: minimalConfig.configPath,
		lockPath,
		reason:
			state.state === "not_installed" ? "database_uninitialized" : undefined,
	};
}
