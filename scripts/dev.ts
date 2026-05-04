import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { parse } from "yaml";

interface DevConfig {
	adminPath: string;
	apiOrigin: string;
}

const DEFAULT_API_PORT = 4401;
const DEFAULT_ADMIN_PATH = "/admin";

function readDevConfig(): DevConfig {
	const configPath = process.env.QINGYAN_CONFIG_PATH ?? "config/qingyan.yml";
	const fallbackPath = "config/qingyan.example.yml";
	const sourcePath = existsSync(configPath) ? configPath : fallbackPath;
	const config = parse(readFileSync(sourcePath, "utf-8")) as {
		admin?: { console?: { path?: string } };
		server?: { port?: number };
	};
	const apiPort = config.server?.port ?? DEFAULT_API_PORT;
	const adminPath = config.admin?.console?.path ?? DEFAULT_ADMIN_PATH;

	return {
		adminPath,
		apiOrigin:
			process.env.QINGYAN_DEV_API_ORIGIN ?? `http://127.0.0.1:${apiPort}`,
	};
}

function pnpmCommand(): string {
	return "pnpm";
}

function createProcessEnv(
	overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (key.startsWith("=") || value === undefined) {
			continue;
		}
		env[key] = value;
	}

	return {
		...env,
		...overrides,
	};
}

function startProcess(
	name: string,
	args: string[],
	env: NodeJS.ProcessEnv = createProcessEnv(),
): ChildProcess {
	const child = spawn(pnpmCommand(), args, {
		cwd: process.cwd(),
		env,
		stdio: "inherit",
	});

	child.on("error", (error) => {
		console.error(`[${name}] failed to start:`, error);
	});

	return child;
}

const { adminPath, apiOrigin } = readDevConfig();
const adminBase = `${adminPath}/`;
const children: ChildProcess[] = [];
let stopping = false;

const devAdminUsername = process.env.QINGYAN_DEV_ADMIN_USERNAME ?? "admin";
const devAdminPassword = process.env.QINGYAN_DEV_ADMIN_PASSWORD ?? "admin";
const devCaptchaAnswer = process.env.QINGYAN_DEV_CAPTCHA_ANSWER ?? "2468";
const devEnv = createProcessEnv({
	QINGYAN_DEV_MODE: "true",
	QINGYAN_DEV_ADMIN_USERNAME: devAdminUsername,
	QINGYAN_DEV_ADMIN_PASSWORD: devAdminPassword,
	QINGYAN_TEST_CAPTCHA_ANSWER: devCaptchaAnswer,
});

console.log(`QingYan API dev server: ${apiOrigin}`);
console.log(`QingYan Admin dev server: http://localhost:5173${adminPath}`);
console.log(`QingYan Dev Admin: ${devAdminUsername} / ${devAdminPassword}`);
console.log(`QingYan Dev Captcha: ${devCaptchaAnswer}`);

if (process.env.QINGYAN_DEV_PRINT_CONFIG_ONLY === "true") {
	process.exit(0);
}

children.push(
	startProcess("api", ["exec", "tsx", "watch", "src/server.ts"], devEnv),
);
children.push(
	startProcess(
		"admin",
		["exec", "vite", "--config", "apps/admin/vite.config.ts"],
		createProcessEnv({
			QINGYAN_ADMIN_BASE: adminBase,
			QINGYAN_DEV_API_ORIGIN: apiOrigin,
		}),
	),
);

function stopAll(exitCode: number): void {
	if (stopping) {
		return;
	}
	stopping = true;
	for (const child of children) {
		if (!child.killed) {
			child.kill();
		}
	}
	process.exitCode = exitCode;
}

for (const child of children) {
	child.on("exit", (code, signal) => {
		if (!stopping) {
			console.error(`Dev process exited: ${signal ?? code ?? 1}`);
			stopAll(code ?? 1);
		}
	});
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
