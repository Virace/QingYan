import { existsSync } from "node:fs";
import path from "node:path";

import { eq, sql } from "drizzle-orm";

import { loadConfig } from "../../config/load-config";
import { createDatabaseClients } from "../../db/client";
import { applyDatabaseMigrations } from "../../db/migrations";
import { adminBootstrapState, sites } from "../../db/schema";
import type { MinimalInstallConfig } from "./minimal-config";

export interface InstallState {
	installed: boolean;
	configPath: string;
	reason?: "config_missing" | "config_invalid" | "database_uninitialized";
	errorMessage?: string;
}

async function databaseInstalled(databaseFile: string): Promise<boolean> {
	const { db, sqlite } = createDatabaseClients(databaseFile);
	try {
		applyDatabaseMigrations(sqlite);
		const [bootstrap] = await db
			.select()
			.from(adminBootstrapState)
			.where(eq(adminBootstrapState.id, 1))
			.limit(1);
		const [siteCount] = await db
			.select({ value: sql<number>`count(*)` })
			.from(sites);

		return Boolean(bootstrap) && Number(siteCount?.value ?? 0) > 0;
	} finally {
		sqlite.close();
	}
}

export async function resolveInstallState(
	minimalConfig: MinimalInstallConfig,
	environment: NodeJS.ProcessEnv = process.env,
): Promise<InstallState> {
	if (!existsSync(minimalConfig.configPath)) {
		return {
			installed: false,
			configPath: minimalConfig.configPath,
			reason: "config_missing",
		};
	}

	try {
		const config = await loadConfig(minimalConfig.configPath, environment);
		const databaseFile = path.resolve(
			process.cwd(),
			config.database.sqlite.file,
		);
		const installed = await databaseInstalled(databaseFile);
		return {
			installed,
			configPath: minimalConfig.configPath,
			reason: installed ? undefined : "database_uninitialized",
		};
	} catch (error) {
		return {
			installed: false,
			configPath: minimalConfig.configPath,
			reason: "config_invalid",
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}
