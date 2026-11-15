import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createLifecycleFixture } from "./lifecycle-fixture";

async function main() {
	const { version } = JSON.parse(
		readFileSync(path.resolve("package.json"), "utf8"),
	) as { version: string };
	const fixture = await createLifecycleFixture({ version });
	const server = spawn(
		process.execPath,
		[require.resolve("tsx/cli"), "src/server.ts"],
		{
			stdio: "inherit",
			env: {
				...process.env,
				QINGYAN_CONFIG_PATH: fixture.configPath,
				QINGYAN_DATABASE_URL: fixture.databaseUrl,
			},
		},
	);
	process.once("SIGINT", () => server.kill("SIGINT"));
	process.once("SIGTERM", () => server.kill("SIGTERM"));
	try {
		process.exitCode = await new Promise<number>((resolve, reject) => {
			server.once("error", reject);
			server.once("exit", (code) => resolve(code ?? 0));
		});
	} finally {
		await fixture.cleanup();
	}
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
