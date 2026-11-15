import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, resolveConfigPath } from "../config/load-config";
import type { AppConfig } from "../config/types";
import { type AppDatabase, createDatabaseClients } from "../db/client";

export interface CliRuntime {
	configPath: string;
	config: AppConfig;
	databaseUrl: string;
	pool: import("pg").Pool;
	db: AppDatabase;
	packageVersion: string;
	close(): Promise<void>;
}

export function resolveCliConfigPath(
	configPath?: string,
	environment: NodeJS.ProcessEnv = process.env,
): string {
	return resolveConfigPath(configPath ?? environment.QINGYAN_CONFIG_PATH);
}

export function readPackageVersion(): string {
	const packagePath = path.resolve(process.cwd(), "package.json");
	const packageJson = JSON.parse(readFileSync(packagePath, "utf-8")) as {
		version?: string;
	};
	return packageJson.version ?? "0.0.0";
}

export async function openCliRuntime(options?: {
	configPath?: string;
	environment?: NodeJS.ProcessEnv;
}): Promise<CliRuntime> {
	const configPath = resolveCliConfigPath(
		options?.configPath,
		options?.environment,
	);
	const config = await loadConfig(configPath, options?.environment);
	const { pool, db, close } = createDatabaseClients(
		config.database.url,
		config.database,
	);

	return {
		configPath,
		config,
		databaseUrl: config.database.url,
		pool,
		db,
		packageVersion: readPackageVersion(),
		close,
	};
}
