import { randomUUID } from "node:crypto";

import type { AppConfig, SiteConfig } from "./types";

export interface AppRuntimeOptions {
	devMode: {
		enabled: boolean;
		adminUsername?: string;
		adminPassword?: string;
		adminToken?: string;
		tokenSource?: "env" | "generated";
		defaultSite?: SiteConfig;
		storage?: "memory";
	};
}

const DEFAULT_DEV_ADMIN_USERNAME = "admin";
const DEFAULT_DEV_ADMIN_PASSWORD = "admin";

function buildDefaultDevSite(
	baseSite: SiteConfig,
	allowedOrigin: string,
): SiteConfig {
	return {
		...baseSite,
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

	const firstSite = config.sites[0];
	if (!firstSite) {
		throw new Error("Dev mode requires at least one configured site.");
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
		defaultSite: buildDefaultDevSite(firstSite, allowedOrigin),
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
