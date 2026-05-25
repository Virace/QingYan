import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import { buildApp } from "../../src/app";
import { resolveRuntimeOptions } from "../../src/config/runtime-options";
import type { AppConfig } from "../../src/config/types";
import { createDatabaseClients } from "../../src/db/client";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import {
	createSiteRegistry,
	type SiteSeed,
} from "../../src/modules/shared/site-registry";

function createTempWorkspace() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-"));
	const databaseFile = path.join(directory, "qingyan.db");
	const logsDirectory = path.join(directory, "logs");

	return {
		directory,
		databaseFile,
		logsDirectory,
		cleanup() {
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

export function applyInitialMigration(databaseFile: string): void {
	const sqlite = new Database(databaseFile);
	const migrationDirectory = path.resolve(process.cwd(), "drizzle");
	const migrationFiles = readdirSync(migrationDirectory)
		.filter((fileName) => fileName.endsWith(".sql"))
		.sort();

	for (const fileName of migrationFiles) {
		const sql = readFileSync(path.join(migrationDirectory, fileName), "utf-8");
		sqlite.exec(sql);
	}

	sqlite.close();
}

async function seedTestSite(
	databaseFile: string,
	site: SiteSeed,
): Promise<void> {
	const { db, sqlite } = createDatabaseClients(databaseFile);
	try {
		await createSiteRegistry().seedSiteFromTemplate(db, site);
	} finally {
		sqlite.close();
	}
}

export const defaultTestSite: SiteSeed = {
	siteKey: "fangyuan",
	name: "FangYuan",
	allowedOrigins: ["http://localhost:4321"],
};

export function createTestConfig(
	databaseFile: string,
	logsDirectory = "./logs",
): AppConfig {
	return {
		server: {
			host: "127.0.0.1",
			port: 4401,
			publicBaseUrl: "http://localhost:4401",
			publicPath: "/qingyan",
			trustProxy: false,
		},
		database: {
			client: "sqlite",
			sqlite: {
				file: databaseFile,
			},
		},
		admin: {
			console: {
				path: "/admin",
			},
			auth: {
				username: "admin",
				passwordHash: createPasswordHash("replace-me"),
			},
			session: {
				cookieName: "qingyan_admin",
				ttlMinutes: 4320,
				sameSite: "lax",
				secure: false,
			},
		},
		security: {
			requestIdHeader: "x-request-id",
			globalFloodGuard: {
				enabled: false,
				windowSec: 10,
				maxRequests: 120,
			},
			publicOriginGuard: {
				enabled: true,
				allowMissingOrigin: true,
			},
			adminOriginGuard: {
				enabled: true,
				allowMissingOrigin: false,
				allowedOrigins: [],
			},
			rateLimit: {
				adminLogin: {
					windowSec: 600,
					maxFailures: 5,
					autoBlacklistSec: 1800,
				},
				commentCreate: {
					windowSec: 300,
					maxRequests: 5,
				},
				commentVote: {
					windowSec: 300,
					maxRequests: 15,
				},
				captchaVerify: {
					windowSec: 300,
					maxFailures: 8,
				},
				pageLike: {
					windowSec: 300,
					maxRequests: 10,
				},
			},
		},
		logging: {
			directory: logsDirectory,
		},
	};
}

export async function createTestApp(options?: {
	devMode?: boolean;
	devAdminToken?: string;
	adminDistDirectory?: string;
	seedSite?: SiteSeed | false;
	mutateConfig?: (config: AppConfig) => void;
}) {
	const workspace = createTempWorkspace();
	applyInitialMigration(workspace.databaseFile);

	const baseConfig = createTestConfig(
		workspace.databaseFile,
		workspace.logsDirectory,
	);
	options?.mutateConfig?.(baseConfig);
	if (!options?.devMode) {
		const site =
			options?.seedSite === false
				? undefined
				: (options?.seedSite ?? defaultTestSite);
		if (!site) {
			throw new Error("Test fixture requires a default site seed.");
		}
		await seedTestSite(workspace.databaseFile, site);
	}
	const resolved = resolveRuntimeOptions(baseConfig, {
		QINGYAN_DEV_MODE: options?.devMode ? "true" : "false",
		QINGYAN_DEV_ADMIN_TOKEN: options?.devAdminToken,
		QINGYAN_DEV_ALLOWED_ORIGIN: "http://localhost:4321",
	});
	const app = await buildApp(resolved.config, resolved.runtimeOptions, {
		adminDistDirectory: options?.adminDistDirectory,
	});

	return {
		app,
		databaseFile: workspace.databaseFile,
		logsDirectory: workspace.logsDirectory,
		runtimeOptions: resolved.runtimeOptions,
		async cleanup() {
			await app.close();
			workspace.cleanup();
		},
	};
}
