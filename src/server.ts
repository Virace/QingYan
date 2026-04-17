import { buildApp } from "./app";
import { loadConfig } from "./config/load-config";

async function main(): Promise<void> {
	const config = await loadConfig();
	const app = await buildApp(config);

	await app.listen({
		host: config.server.host,
		port: config.server.port,
	});
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
