import path from "node:path";

import { loadConfig } from "./config/load-config";
import type { AppConfig } from "./config/types";
import {
	detectUpgradeRuntimeState,
	type UpgradeRuntimeState,
} from "./modules/upgrade/state";

export type StartupMode =
	| { mode: "install"; reason?: string }
	| { mode: "normal"; config: AppConfig; databaseFile: string }
	| {
			mode: "upgrade";
			config?: AppConfig;
			configError?: unknown;
			databaseFile: string;
			state: Extract<
				UpgradeRuntimeState,
				{ state: "upgrade_required" | "recovery_required" | "broken_config" }
			>;
	  };

export async function resolveStartupMode(input: {
	installed: boolean;
	installReason?: string;
	configPath: string;
	currentApplicationVersion: string;
	partialUpgradeMarkerPath: string;
	createSqliteClient: Parameters<
		typeof detectUpgradeRuntimeState
	>[0]["createSqliteClient"];
	environment?: NodeJS.ProcessEnv;
}): Promise<StartupMode> {
	if (!input.installed) {
		return { mode: "install", reason: input.installReason };
	}

	let config: AppConfig | undefined;
	let configError: unknown;
	try {
		config = await loadConfig(input.configPath, input.environment);
	} catch (error) {
		configError = error;
	}
	const databaseFile = config
		? path.resolve(process.cwd(), config.database.sqlite.file)
		: path.resolve(process.cwd(), "config", "qingyan.db");
	const state = detectUpgradeRuntimeState({
		configPath: input.configPath,
		loadedConfig: config,
		configError,
		databaseFile,
		createSqliteClient: input.createSqliteClient,
		currentApplicationVersion: input.currentApplicationVersion,
		partialUpgradeMarkerPath: input.partialUpgradeMarkerPath,
	});
	if (
		state.state === "upgrade_required" ||
		state.state === "recovery_required" ||
		state.state === "broken_config"
	) {
		return {
			mode: "upgrade",
			config,
			configError,
			databaseFile,
			state,
		};
	}
	if (!config) {
		return { mode: "install", reason: "config_missing" };
	}
	return { mode: "normal", config, databaseFile };
}
