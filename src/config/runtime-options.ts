import { randomUUID } from "node:crypto";

import type { AppConfig, SiteConfig } from "./types";

export interface AppRuntimeOptions {
	devMode: {
		enabled: boolean;
		adminToken?: string;
		tokenSource?: "env" | "generated";
	};
}

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
	const enabled = environment.QINGYAN_DEV_MODE === "true";
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

	return {
		config: {
			...config,
			sites: [buildDefaultDevSite(firstSite, allowedOrigin)],
		},
		runtimeOptions: {
			devMode: {
				enabled: true,
				adminToken,
				tokenSource,
			},
		},
	};
}
