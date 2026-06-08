import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";

import { parse } from "yaml";

import { loadConfig } from "../src/config/load-config";
import { joinPublicPath, normalizePublicPath } from "../src/config/public-path";
import { createDatabaseClients } from "../src/db/client";
import { adminBootstrapState } from "../src/db/schema";
import {
	resolveInstallUrl,
	resolveMinimalInstallConfig,
} from "../src/modules/install/minimal-config";
import { resolveInstallState } from "../src/modules/install/state";

interface DevConfig {
	adminPath: string;
	apiBase: string;
	apiOrigin: string;
}

const DEFAULT_API_PORT = 4401;
const DEFAULT_ADMIN_PATH = "/admin";
const DEFAULT_PUBLIC_PATH = "/qingyan";
const API_READY_TIMEOUT_MS = 15_000;
const API_READY_RETRY_MS = 100;

async function readAdminPathFromDatabase(
	configPath: string,
	environment: NodeJS.ProcessEnv,
): Promise<string | undefined> {
	const config = await loadConfig(configPath, environment);
	const databaseFile = path.resolve(process.cwd(), config.database.sqlite.file);
	const { db, sqlite } = createDatabaseClients(databaseFile);
	try {
		const [bootstrap] = await db.select().from(adminBootstrapState).limit(1);
		return bootstrap?.consolePath;
	} finally {
		sqlite.close();
	}
}

async function readDevConfig(
	environment: NodeJS.ProcessEnv,
): Promise<DevConfig> {
	const configPath = process.env.QINGYAN_CONFIG_PATH ?? "config/qingyan.yml";
	const fallbackPath = "config/qingyan.example.yml";
	const sourcePath = existsSync(configPath) ? configPath : fallbackPath;
	const config = parse(readFileSync(sourcePath, "utf-8")) as {
		admin?: { console?: { path?: string } };
		server?: { port?: number; publicPath?: string };
	};
	const apiPort = config.server?.port ?? DEFAULT_API_PORT;
	const publicPath = normalizePublicPath(config.server?.publicPath);
	const internalAdminPath =
		(sourcePath === configPath
			? await readAdminPathFromDatabase(configPath, environment)
			: undefined) ??
		config.admin?.console?.path ??
		DEFAULT_ADMIN_PATH;
	const adminPath = joinPublicPath(publicPath, internalAdminPath);

	return {
		adminPath,
		apiBase: joinPublicPath(publicPath, "/api"),
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
	child.on("exit", (code, signal) => {
		if (!stopping) {
			console.error(`[${name}] dev process exited: ${signal ?? code ?? 1}`);
			stopAll(code ?? 1);
		}
	});

	return child;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function canConnectTcp(origin: string): Promise<boolean> {
	const url = new URL(origin);
	const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
	const host = url.hostname.replace(/^\[|\]$/gu, "");
	return new Promise((resolve) => {
		const socket = createConnection({ host, port });
		const finish = (connected: boolean) => {
			socket.removeAllListeners();
			socket.destroy();
			resolve(connected);
		};
		socket.setTimeout(1_000);
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
		socket.once("timeout", () => finish(false));
	});
}

async function waitForApiOrigin(origin: string): Promise<void> {
	const deadline = Date.now() + API_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await canConnectTcp(origin)) {
			return;
		}
		await sleep(API_READY_RETRY_MS);
	}
	throw new Error(
		`API 开发服务未在 ${API_READY_TIMEOUT_MS}ms 内监听：${origin}`,
	);
}

function buildAdminDevPaths(adminPath: string): string {
	const defaultAdminPath = joinPublicPath(
		DEFAULT_PUBLIC_PATH,
		DEFAULT_ADMIN_PATH,
	);
	return adminPath === defaultAdminPath
		? defaultAdminPath
		: `${adminPath},${defaultAdminPath}`;
}

function defaultExternalAdminPath(): string {
	return joinPublicPath(DEFAULT_PUBLIC_PATH, DEFAULT_ADMIN_PATH);
}

const devAdminUsername = process.env.QINGYAN_DEV_ADMIN_USERNAME ?? "admin";
const devAdminPassword = process.env.QINGYAN_DEV_ADMIN_PASSWORD ?? "admin";
const devCaptchaAnswer = process.env.QINGYAN_DEV_CAPTCHA_ANSWER ?? "2468";
const devEnv = createProcessEnv({
	QINGYAN_DEV_MODE: "true",
	QINGYAN_DEV_ADMIN_USERNAME: devAdminUsername,
	QINGYAN_DEV_ADMIN_PASSWORD: devAdminPassword,
	QINGYAN_TEST_CAPTCHA_ANSWER: devCaptchaAnswer,
});

const children: ChildProcess[] = [];
let stopping = false;

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

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

async function main(): Promise<void> {
	const minimalInstallConfig = resolveMinimalInstallConfig(devEnv);
	const installState = await resolveInstallState(minimalInstallConfig, devEnv);

	if (!installState.installed) {
		console.log("QingYan install mode:");
		console.log(`install.url=${resolveInstallUrl(minimalInstallConfig)}`);

		if (process.env.QINGYAN_DEV_PRINT_CONFIG_ONLY === "true") {
			process.exit(0);
		}

		children.push(
			startProcess("api", ["exec", "tsx", "watch", "src/server.ts"], devEnv),
		);
		return;
	}

	const { adminPath, apiBase, apiOrigin } = await readDevConfig(devEnv);
	const adminBase = "/";

	console.log(`QingYan API dev server: ${apiOrigin}`);
	console.log(`QingYan Admin API base: ${apiBase}`);
	console.log(`QingYan Admin dev server: http://localhost:5173${adminPath}`);
	if (adminPath !== defaultExternalAdminPath()) {
		console.log(
			`QingYan Admin dev alias: http://localhost:5173${defaultExternalAdminPath()}`,
		);
	}
	console.log(`QingYan Dev Admin: ${devAdminUsername} / ${devAdminPassword}`);
	console.log(`QingYan Dev Captcha: ${devCaptchaAnswer}`);

	if (process.env.QINGYAN_DEV_PRINT_CONFIG_ONLY === "true") {
		process.exit(0);
	}

	children.push(
		startProcess("api", ["exec", "tsx", "watch", "src/server.ts"], devEnv),
	);
	await waitForApiOrigin(apiOrigin);
	console.log(`QingYan API dev server ready: ${apiOrigin}`);
	children.push(
		startProcess(
			"admin",
			["exec", "vite", "--config", "apps/admin/vite.config.ts"],
			createProcessEnv({
				QINGYAN_ADMIN_BASE: adminBase,
				QINGYAN_ADMIN_DEV_PATHS: buildAdminDevPaths(adminPath),
				QINGYAN_DEV_API_BASE: apiBase,
				QINGYAN_DEV_API_ORIGIN: apiOrigin,
			}),
		),
	);
}

void main().catch((error: unknown) => {
	console.error("dev.crashed", error);
	stopAll(1);
});
