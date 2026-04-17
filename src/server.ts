import { buildApp } from "./app";
import { loadConfig } from "./config/load-config";

async function main(): Promise<void> {
	const config = await loadConfig();
	const app = await buildApp(config);

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
