import { readFileSync } from "node:fs";
import path from "node:path";

import type { AppConfig } from "../config/types";
import { loadConfig, resolveConfigPath } from "../config/load-config";
import {
	createDatabaseClients,
	type AppDatabase,
	type SqliteClient,
} from "../db/client";

export interface CliRuntime {
	configPath: string;
	config: AppConfig;
	databaseFile: string;
	sqlite: SqliteClient;
	db: AppDatabase;
	packageVersion: string;
	close(): void;
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
	const databaseFile = path.resolve(process.cwd(), config.database.sqlite.file);
	const { sqlite, db } = createDatabaseClients(databaseFile);

	return {
		configPath,
		config,
		databaseFile,
		sqlite,
		db,
		packageVersion: readPackageVersion(),
		close() {
			sqlite.close();
		},
	};
}
