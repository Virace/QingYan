import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveConfigPath } from "../../config/load-config";
import { buildPublicUrl, normalizePublicPath } from "../../config/public-path";

export type InstallRestartMode = "manual" | "exit";
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
	restartMode: InstallRestartMode;
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

function parseRestartMode(value: string | undefined): InstallRestartMode {
	if (!value) {
		return "manual";
	}
	if (value === "manual" || value === "exit") {
		return value;
	}
	throw new Error("QINGYAN_INSTALL_RESTART_MODE must be manual or exit.");
}

function parseTransitionMode(input: {
	value: string | undefined;
	legacyRestartMode: InstallRestartMode;
}): InstallTransitionMode {
	if (!input.value) {
		return input.legacyRestartMode === "exit"
			? "exit_for_supervisor"
			: "reload_in_process";
	}
	if (
		input.value === "reload_in_process" ||
		input.value === "exit_for_supervisor" ||
		input.value === "manual"
	) {
		return input.value;
	}
	throw new Error(
		"QINGYAN_INSTALL_TRANSITION_MODE must be reload_in_process, exit_for_supervisor, or manual.",
	);
}

export function resolveMinimalInstallConfig(
	environment: NodeJS.ProcessEnv = process.env,
): MinimalInstallConfig {
	const restartMode = parseRestartMode(
		environment.QINGYAN_INSTALL_RESTART_MODE,
	);
	return {
		configPath: resolveConfigPath(environment.QINGYAN_CONFIG_PATH),
		host: environment.QINGYAN_SERVER_HOST ?? "127.0.0.1",
		port: parsePort(environment.QINGYAN_SERVER_PORT, 4401),
		publicPath: normalizePublicPath(environment.QINGYAN_PUBLIC_PATH),
		token: environment.QINGYAN_INSTALL_TOKEN ?? `qy_install_${randomUUID()}`,
		disabled: environment.QINGYAN_INSTALL_DISABLED === "true",
		restartMode,
		transitionMode: parseTransitionMode({
			value: environment.QINGYAN_INSTALL_TRANSITION_MODE,
			legacyRestartMode: restartMode,
		}),
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
