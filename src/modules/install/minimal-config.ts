import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveConfigPath } from "../../config/load-config";

export interface MinimalInstallConfig {
	configPath: string;
	host: string;
	port: number;
	token: string;
	disabled: boolean;
}

function parsePort(value: string | undefined, fallback: number): number {
	if (!value) {
		return fallback;
	}
	const port = Number(value);
	if (!Number.isInteger(port) || port <= 0) {
		throw new Error("QINGYAN_SERVER_PORT must be a positive integer.");
	}
	return port;
}

export function resolveMinimalInstallConfig(
	environment: NodeJS.ProcessEnv = process.env,
): MinimalInstallConfig {
	return {
		configPath: resolveConfigPath(environment.QINGYAN_CONFIG_PATH),
		host: environment.QINGYAN_SERVER_HOST ?? "127.0.0.1",
		port: parsePort(environment.QINGYAN_SERVER_PORT, 4401),
		token: environment.QINGYAN_INSTALL_TOKEN ?? `qy_install_${randomUUID()}`,
		disabled: environment.QINGYAN_INSTALL_DISABLED === "true",
	};
}

export function resolveInstallUrl(input: MinimalInstallConfig): string {
	return new URL(
		`/install?token=${encodeURIComponent(input.token)}`,
		`http://${input.host}:${input.port}`,
	).toString();
}

export function resolveInstallPath(
	configPath: string,
	targetPath: string,
): string {
	return path.resolve(path.dirname(configPath), targetPath);
}
