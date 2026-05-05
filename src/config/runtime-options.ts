import { randomUUID } from "node:crypto";

import type { AppConfig } from "./types";

export interface DevSiteSeed {
	siteKey: "default";
	name: string;
	allowedOrigins: string[];
}

export interface AppRuntimeOptions {
	devMode: {
		enabled: boolean;
		adminUsername?: string;
		adminPassword?: string;
		adminToken?: string;
		tokenSource?: "env" | "generated";
		seed?: {
			site: DevSiteSeed;
		};
		storage?: "memory";
	};
}

const DEFAULT_DEV_ADMIN_USERNAME = "admin";
const DEFAULT_DEV_ADMIN_PASSWORD = "admin";

function buildDefaultDevSite(allowedOrigin: string): DevSiteSeed {
	return {
		siteKey: "default",
		name: "Default",
		allowedOrigins: [allowedOrigin],
	};
}

export function resolveRuntimeOptions(
	config: AppConfig,
	environment: NodeJS.ProcessEnv = process.env,
): { config: AppConfig; runtimeOptions: AppRuntimeOptions } {
	const useMemoryStorage = environment.QINGYAN_DATABASE_MODE === "none";
	const enabled = environment.QINGYAN_DEV_MODE === "true" || useMemoryStorage;
	if (!enabled) {
		return {
			config,
			runtimeOptions: {
				devMode: {
					enabled: false,
				},
			},
		};
	}

	const allowedOrigin =
		environment.QINGYAN_DEV_ALLOWED_ORIGIN ?? "http://localhost:4321";
	const adminToken =
		environment.QINGYAN_DEV_ADMIN_TOKEN ?? `qy_dev_${randomUUID()}`;
	const tokenSource = environment.QINGYAN_DEV_ADMIN_TOKEN ? "env" : "generated";
	const devMode: AppRuntimeOptions["devMode"] = {
		enabled: true,
		adminUsername:
			environment.QINGYAN_DEV_ADMIN_USERNAME ?? DEFAULT_DEV_ADMIN_USERNAME,
		adminPassword:
			environment.QINGYAN_DEV_ADMIN_PASSWORD ?? DEFAULT_DEV_ADMIN_PASSWORD,
		adminToken,
		tokenSource,
		seed: {
			site: buildDefaultDevSite(allowedOrigin),
		},
	};
	if (useMemoryStorage) {
		devMode.storage = "memory";
	}

	return {
		config,
		runtimeOptions: {
			devMode,
		},
	};
}
