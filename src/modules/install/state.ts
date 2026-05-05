import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
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
	lockPath: string;
	reason?:
		| "config_missing"
		| "config_invalid"
		| "database_uninitialized"
		| "lock_missing";
	errorMessage?: string;
}

export function resolveInstallLockPath(configPath: string): string {
	return path.join(path.dirname(configPath), "qingyan.installed.lock");
}

export async function writeInstallLock(input: {
	configPath: string;
	databasePath: string;
	adminConsolePath: string;
}): Promise<string> {
	const lockPath = resolveInstallLockPath(input.configPath);
	await mkdir(path.dirname(lockPath), { recursive: true });
	const payload = {
		installedAt: new Date().toISOString(),
		configPath: input.configPath,
		databasePath: input.databasePath,
		adminConsolePath: input.adminConsolePath,
	};
	const tmpPath = `${lockPath}.${Date.now()}.tmp`;
	await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
	await rename(tmpPath, lockPath);
	return lockPath;
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
	const lockPath = resolveInstallLockPath(minimalConfig.configPath);
	if (existsSync(lockPath)) {
		return {
			installed: true,
			configPath: minimalConfig.configPath,
			lockPath,
		};
	}

	if (!existsSync(minimalConfig.configPath)) {
		return {
			installed: false,
			configPath: minimalConfig.configPath,
			lockPath,
			reason: "config_missing",
		};
	}

	try {
		const config = await loadConfig(minimalConfig.configPath, environment);
		const databaseFile = path.resolve(
			process.cwd(),
			config.database.sqlite.file,
		);
		const initialized = await databaseInstalled(databaseFile);
		return {
			installed: false,
			configPath: minimalConfig.configPath,
			lockPath,
			reason: initialized ? "lock_missing" : "database_uninitialized",
		};
	} catch (error) {
		return {
			installed: false,
			configPath: minimalConfig.configPath,
			lockPath,
			reason: "config_invalid",
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}
