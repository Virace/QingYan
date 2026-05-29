import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveConfigPath } from "../../config/load-config";
import { buildPublicUrl, normalizePublicPath } from "../../config/public-path";

export type InstallTransitionMode =
	| "reload_in_process"
	| "exit_for_supervisor"
	| "manual";

export interface MinimalInstallConfig {
	configPath: string;
	host: string;
	port: number;
	publicPath: string;
	token: string;
	disabled: boolean;
	transitionMode: InstallTransitionMode;
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

function parseTransitionMode(value: string | undefined): InstallTransitionMode {
	if (!value) {
		return "reload_in_process";
	}
	if (
		value === "reload_in_process" ||
		value === "exit_for_supervisor" ||
		value === "manual"
	) {
		return value;
	}
	throw new Error(
		"QINGYAN_INSTALL_TRANSITION_MODE must be reload_in_process, exit_for_supervisor, or manual.",
	);
}

export function resolveMinimalInstallConfig(
	environment: NodeJS.ProcessEnv = process.env,
): MinimalInstallConfig {
	return {
		configPath: resolveConfigPath(environment.QINGYAN_CONFIG_PATH),
		host: environment.QINGYAN_SERVER_HOST ?? "127.0.0.1",
		port: parsePort(environment.QINGYAN_SERVER_PORT, 4401),
		publicPath: normalizePublicPath(environment.QINGYAN_PUBLIC_PATH),
		token: environment.QINGYAN_INSTALL_TOKEN ?? `qy_install_${randomUUID()}`,
		disabled: environment.QINGYAN_INSTALL_DISABLED === "true",
		transitionMode: parseTransitionMode(
			environment.QINGYAN_INSTALL_TRANSITION_MODE,
		),
	};
}

export function resolveInstallUrl(input: MinimalInstallConfig): string {
	return buildPublicUrl(
		`http://${input.host}:${input.port}`,
		input.publicPath,
		"/admin/install",
	);
}

export function resolveInstallPath(
	configPath: string,
	targetPath: string,
): string {
	return path.resolve(path.dirname(configPath), targetPath);
}
