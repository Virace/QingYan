import { loadConfig } from "./config/load-config";
import type { AppConfig } from "./config/types";
import {
	detectUpgradeRuntimeState,
	type UpgradeRuntimeState,
} from "./modules/upgrade/state";

export type StartupMode =
	| { mode: "install"; reason?: string }
	| { mode: "normal"; config: AppConfig; databaseUrl: string }
	| {
			mode: "upgrade";
			config?: AppConfig;
			configError?: unknown;
			databaseUrl: string;
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
	const databaseUrl = config?.database.url ?? "";
	const state = await detectUpgradeRuntimeState({
		configPath: input.configPath,
		loadedConfig: config,
		configError,
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
			databaseUrl,
			state,
		};
	}
	if (state.state === "not_installed")
		return { mode: "install", reason: "database_uninitialized" };
	if (!config) throw new Error("CONFIG_REQUIRED");
	return { mode: "normal", config, databaseUrl };
}
