import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildApp } from "./app";
import { buildPublicUrl } from "./config/public-path";
import { resolveRuntimeOptions } from "./config/runtime-options";
import { buildInstallApp } from "./modules/install/install-app";
import {
	resolveInstallUrl,
	resolveMinimalInstallConfig,
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

async function main(): Promise<void> {
	const minimalInstallConfig = resolveMinimalInstallConfig();
	const installState = await resolveInstallState(minimalInstallConfig);
	const startupMode = await resolveStartupMode({
		installed: installState.installed,
		installReason: installState.reason,
		configPath: minimalInstallConfig.configPath,
		currentApplicationVersion: readPackageVersion(),
		partialUpgradeMarkerPath: path.join(
			path.dirname(minimalInstallConfig.configPath),
			"..",
			"data",
			"upgrade",
			"partial-upgrade.json",
		),
		createSqliteClient: (file) => new Database(file),
	});
	if (startupMode.mode === "install") {
		if (minimalInstallConfig.disabled) {
			throw new Error(
				`QingYan is not installed and install mode is disabled: ${installState.reason ?? "unknown"}`,
			);
		}
		const installApp = buildInstallApp({
			minimalConfig: minimalInstallConfig,
			scheduleRestart: (transition) => {
				setTimeout(() => {
					process.exit(0);
				}, transition.restartAfterMs);
			},
		});
		await installApp.listen({
			host: minimalInstallConfig.host,
			port: minimalInstallConfig.port,
		});
		console.log(`install.url=${resolveInstallUrl(minimalInstallConfig)}`);
		return;
	}
	if (startupMode.mode === "upgrade") {
		const upgradeApp = createUpgradeApp({
			configPath: minimalInstallConfig.configPath,
			loadedConfig: startupMode.config,
			configError: startupMode.configError,
			databaseFile: startupMode.databaseFile,
			currentApplicationVersion: readPackageVersion(),
			partialUpgradeMarkerPath: path.join(
				path.dirname(minimalInstallConfig.configPath),
				"..",
				"data",
				"upgrade",
				"partial-upgrade.json",
			),
			createSqliteClient: (file) => new Database(file),
		});
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
		return;
	}

	const { config, runtimeOptions } = resolveRuntimeOptions(startupMode.config);
	const app = await buildApp(config, runtimeOptions);

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
		console.log(`dev.admin.token=${runtimeOptions.devMode.adminToken ?? ""}`);
	}
}

void main().catch((error: unknown) => {
	if (error instanceof Error) {
		console.error("service.crashed", error);
	} else {
		console.error("service.crashed", String(error));
	}
	console.error(error);
	process.exitCode = 1;
});
