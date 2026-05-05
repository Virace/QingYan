import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import { stringify } from "yaml";

import { configSchema, type StartupConfig } from "../../config/types";
import { createDatabaseClients } from "../../db/client";
import { applyDatabaseMigrations } from "../../db/migrations";
import { adminBootstrapState } from "../../db/schema";
import { createPasswordHash } from "../admin/password-hash";
import { createSiteRegistry } from "../shared/site-registry";
import { AdminSystemSettingsRepository } from "../admin/system-settings-repository";
import type { MinimalInstallConfig } from "./minimal-config";

export const installApplySchema = z.object({
	token: z.string().min(1),
	server: z.object({
		host: z.string().min(1).default("0.0.0.0"),
		port: z.number().int().positive().default(4401),
		publicBaseUrl: z.string().url(),
		trustProxy: z.boolean().default(true),
	}),
	database: z.object({
		sqliteFile: z.string().min(1).default("./data/qingyan.db"),
	}),
	admin: z.object({
		consolePath: z.string().min(1).default("/admin"),
		username: z.string().min(1).default("admin"),
		password: z.string().min(8).default("adminadmin"),
	}),
	site: z.object({
		siteKey: z.string().min(1).default("default"),
		name: z.string().min(1).default("Default"),
		allowedOrigins: z.array(z.string().url()).min(1),
	}),
});

export type InstallApplyInput = z.infer<typeof installApplySchema>;

function buildStartupConfig(input: InstallApplyInput): StartupConfig {
	return {
		server: {
			host: input.server.host,
			port: input.server.port,
			publicBaseUrl: input.server.publicBaseUrl,
			trustProxy: input.server.trustProxy,
		},
		database: {
			client: "sqlite",
			sqlite: {
				file: input.database.sqliteFile,
			},
		},
		admin: {
			session: {
				cookieName: "qingyan_admin",
				ttlMinutes: 1440,
				sameSite: "lax",
				secure: input.server.publicBaseUrl.startsWith("https://"),
			},
		},
		security: {
			requestIdHeader: "x-request-id",
			globalFloodGuard: {
				enabled: true,
				windowSec: 10,
				maxRequests: 120,
			},
			publicOriginGuard: {
				enabled: true,
				allowMissingOrigin: false,
			},
			rateLimit: {
				adminLogin: {
					windowSec: 600,
					maxFailures: 5,
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
	};
}

async function writeStartupConfig(configPath: string, config: StartupConfig) {
	const validated = configSchema.parse(config);
	await mkdir(path.dirname(configPath), { recursive: true });
	const tmpPath = `${configPath}.${Date.now()}.tmp`;
	await writeFile(tmpPath, stringify(validated), "utf-8");
	await rename(tmpPath, configPath);
}

async function seedDatabase(input: {
	databaseFile: string;
	admin: InstallApplyInput["admin"];
	site: InstallApplyInput["site"];
}) {
	const { db, sqlite } = createDatabaseClients(input.databaseFile);
	try {
		applyDatabaseMigrations(sqlite);
		const registry = createSiteRegistry();
		await db.insert(adminBootstrapState).values({
			id: 1,
			consolePath: input.admin.consolePath,
			username: input.admin.username,
			passwordHash: createPasswordHash(input.admin.password),
			passwordRotatedAt: null,
		});
		await registry.seedSiteFromTemplate(db, input.site);
		const systemSettings = new AdminSystemSettingsRepository(db);
		await systemSettings.upsert("logging", "level", "info");
		await systemSettings.upsert("logging", "retentionDays", 7);
	} finally {
		sqlite.close();
	}
}

export async function applyInstall(input: {
	minimalConfig: MinimalInstallConfig;
	payload: InstallApplyInput;
}) {
	if (input.payload.token !== input.minimalConfig.token) {
		throw new Error("INSTALL_TOKEN_INVALID");
	}

	const startupConfig = buildStartupConfig(input.payload);
	await writeStartupConfig(input.minimalConfig.configPath, startupConfig);
	const databaseFile = path.resolve(
		process.cwd(),
		startupConfig.database.sqlite.file,
	);
	await mkdir(path.dirname(databaseFile), { recursive: true });
	await seedDatabase({
		databaseFile,
		admin: input.payload.admin,
		site: input.payload.site,
	});

	return {
		adminUrl: new URL(
			input.payload.admin.consolePath,
			startupConfig.server.publicBaseUrl,
		).toString(),
		username: input.payload.admin.username,
		initialPassword: input.payload.admin.password,
		configPath: input.minimalConfig.configPath,
		databasePath: databaseFile,
		restartRequired: true,
	};
}
