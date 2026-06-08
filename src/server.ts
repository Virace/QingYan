import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildApp } from "./app";
import { buildPublicUrl } from "./config/public-path";
import { resolveRuntimeOptions } from "./config/runtime-options";
import {
	buildInstallApp,
	type InstallTransition,
} from "./modules/install/install-app";
import {
	resolveInstallUrl,
	resolveMinimalInstallConfig,
	type MinimalInstallConfig,
} from "./modules/install/minimal-config";
import { resolveInstallState } from "./modules/install/state";
import { createUpgradeApp } from "./modules/upgrade/upgrade-app";
import { resolveStartupMode } from "./startup-mode";

function readPackageVersion(): string {
	const packagePath = path.resolve(process.cwd(), "package.json");
	const packageJson = JSON.parse(readFileSync(packagePath, "utf-8")) as {
		version?: string;
	};
	return packageJson.version ?? "0.0.0";
}

function partialUpgradeMarkerPath(configPath: string): string {
	return path.join(
		path.dirname(configPath),
		"..",
		"data",
		"upgrade",
		"partial-upgrade.json",
	);
}

type LifecycleMode = "install" | "upgrade" | "normal";

type LifecycleTransition = Pick<InstallTransition, "mode"> &
	Partial<Pick<InstallTransition, "restartAfterMs">>;

export interface ServerLifecycle {
	start(): Promise<void>;
}

export function createServerLifecycle(input: {
	resolveMode: () => Promise<LifecycleMode>;
	startInstall: (input: {
		scheduleTransition: (transition: LifecycleTransition) => Promise<void>;
	}) => Promise<void>;
	startUpgrade: () => Promise<void>;
	startNormal: () => Promise<void>;
	closeActive?: () => Promise<void>;
	exitProcess: () => void;
	delay?: (ms: number) => Promise<void>;
}): ServerLifecycle {
	const delay =
		input.delay ??
		((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

	async function scheduleTransition(
		transition: LifecycleTransition,
	): Promise<void> {
		if (transition.mode === "manual") {
			return;
		}
		await delay(transition.restartAfterMs ?? 0);
		if (transition.mode === "exit_for_supervisor") {
			input.exitProcess();
			return;
		}
		await input.closeActive?.();
		await start();
	}

	async function start(): Promise<void> {
		const mode = await input.resolveMode();
		if (mode === "install") {
			await input.startInstall({ scheduleTransition });
			return;
		}
		if (mode === "upgrade") {
			await input.startUpgrade();
			return;
		}
		await input.startNormal();
	}

	return { start };
}

async function resolveCurrentStartupMode(
	minimalInstallConfig: MinimalInstallConfig,
) {
	const installState = await resolveInstallState(minimalInstallConfig);
	return resolveStartupMode({
		installed: installState.installed,
		installReason: installState.reason,
		configPath: minimalInstallConfig.configPath,
		currentApplicationVersion: readPackageVersion(),
		partialUpgradeMarkerPath: partialUpgradeMarkerPath(
			minimalInstallConfig.configPath,
		),
		createSqliteClient: (file) => new Database(file),
	});
}

export async function main(): Promise<void> {
	const minimalInstallConfig = resolveMinimalInstallConfig();
	let activeApp: FastifyInstance | undefined;

	const lifecycle = createServerLifecycle({
		resolveMode: async () => {
			const startupMode = await resolveCurrentStartupMode(minimalInstallConfig);
			return startupMode.mode;
		},
		closeActive: async () => {
			await activeApp?.close();
			activeApp = undefined;
		},
		exitProcess: () => {
			process.exit(0);
		},
		startInstall: async ({ scheduleTransition }) => {
			const installState = await resolveInstallState(minimalInstallConfig);
			if (minimalInstallConfig.disabled) {
				throw new Error(
					`QingYan is not installed and install mode is disabled: ${installState.reason ?? "unknown"}`,
				);
			}
			const installApp = buildInstallApp({
				minimalConfig: minimalInstallConfig,
				scheduleTransition: (transition) => {
					void scheduleTransition(transition).catch((error: unknown) => {
						console.error("install.transition.failed", error);
					});
				},
			});
			activeApp = installApp;
			await installApp.listen({
				host: minimalInstallConfig.host,
				port: minimalInstallConfig.port,
			});
			console.log(`install.url=${resolveInstallUrl(minimalInstallConfig)}`);
		},
		startUpgrade: async () => {
			const startupMode = await resolveCurrentStartupMode(minimalInstallConfig);
			if (startupMode.mode !== "upgrade") {
				throw new Error(
					`Expected upgrade startup mode, got ${startupMode.mode}.`,
				);
			}
			const upgradeApp = createUpgradeApp({
				configPath: minimalInstallConfig.configPath,
				loadedConfig: startupMode.config,
				configError: startupMode.configError,
				databaseFile: startupMode.databaseFile,
				currentApplicationVersion: readPackageVersion(),
				partialUpgradeMarkerPath: partialUpgradeMarkerPath(
					minimalInstallConfig.configPath,
				),
				createSqliteClient: (file) => new Database(file),
			});
			activeApp = upgradeApp;
			const listenConfig = startupMode.config?.server ?? minimalInstallConfig;
			await upgradeApp.listen({
				host: listenConfig.host,
				port: listenConfig.port,
			});
			const host =
				listenConfig.host === "0.0.0.0" || listenConfig.host === "::"
					? "localhost"
					: listenConfig.host;
			console.log(
				`upgrade.url=${buildPublicUrl(
					`http://${host}:${listenConfig.port}`,
					listenConfig.publicPath,
					"/upgrade",
				)}`,
			);
			console.log(`upgrade.state=${startupMode.state.state}`);
		},
		startNormal: async () => {
			const startupMode = await resolveCurrentStartupMode(minimalInstallConfig);
			if (startupMode.mode !== "normal") {
				throw new Error(
					`Expected normal startup mode, got ${startupMode.mode}.`,
				);
			}
			const { config, runtimeOptions } = resolveRuntimeOptions(
				startupMode.config,
			);
			const app = await buildApp(config, runtimeOptions);
			activeApp = app;

			await app.listen({
				host: config.server.host,
				port: config.server.port,
			});

			await app.loggerManager.logApp({
				level: "info",
				channel: "app",
				event: "service.started",
				message: "服务已启动",
				data: {
					host: config.server.host,
					port: config.server.port,
				},
			});

			console.log(
				`admin.console.url=${buildPublicUrl(config.server.publicBaseUrl, config.server.publicPath, app.adminBootstrap.consolePath)}`,
			);
			console.log(`admin.username=${app.adminBootstrap.username}`);
			if (app.adminBootstrap.generatedPassword) {
				console.log(`admin.password=${app.adminBootstrap.generatedPassword}`);
			} else {
				console.log(
					"admin.password=<configured password for admin.auth.passwordHash>",
				);
			}

			if (
				runtimeOptions.devMode.enabled &&
				runtimeOptions.devMode.tokenSource === "generated"
			) {
				console.log(
					`dev.admin.token=${runtimeOptions.devMode.adminToken ?? ""}`,
				);
			}
		},
	});

	await lifecycle.start();
}

if (require.main === module) {
	void main().catch((error: unknown) => {
		if (error instanceof Error) {
			console.error("service.crashed", error);
		} else {
			console.error("service.crashed", String(error));
		}
		console.error(error);
		process.exitCode = 1;
	});
}
