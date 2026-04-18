import { buildApp } from "./app";
import { loadConfig } from "./config/load-config";
import { resolveRuntimeOptions } from "./config/runtime-options";

async function main(): Promise<void> {
	const loadedConfig = await loadConfig();
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
