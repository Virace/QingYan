import { buildApp } from "./app";
import { loadConfig } from "./config/load-config";
import { resolveRuntimeOptions } from "./config/runtime-options";
import { buildInstallApp } from "./modules/install/install-app";
import {
	resolveInstallUrl,
	resolveMinimalInstallConfig,
} from "./modules/install/minimal-config";
import { resolveInstallState } from "./modules/install/state";

function resolveAdminUrl(publicBaseUrl: string, consolePath: string): string {
	return new URL(consolePath, publicBaseUrl).toString();
}

async function main(): Promise<void> {
	const minimalInstallConfig = resolveMinimalInstallConfig();
	const installState = await resolveInstallState(minimalInstallConfig);
	if (!installState.installed) {
		if (minimalInstallConfig.disabled) {
			throw new Error(
				`QingYan is not installed and install mode is disabled: ${installState.reason ?? "unknown"}`,
			);
		}
		const installApp = buildInstallApp({ minimalConfig: minimalInstallConfig });
		await installApp.listen({
			host: minimalInstallConfig.host,
			port: minimalInstallConfig.port,
		});
		console.log(`install.url=${resolveInstallUrl(minimalInstallConfig)}`);
		return;
	}

	const loadedConfig = await loadConfig(minimalInstallConfig.configPath);
	const { config, runtimeOptions } = resolveRuntimeOptions(loadedConfig);
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
		`admin.console.url=${resolveAdminUrl(config.server.publicBaseUrl, app.adminBootstrap.consolePath)}`,
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
