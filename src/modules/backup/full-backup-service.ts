import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

import type { AppConfig } from "../../config/types";
import { envMappings } from "../../config/env-mapping";
import type { SqliteClient } from "../../db/client";
import { resolveInstallLockPath } from "../install/state";

export interface FullBackupFileManifest {
	path: string;
	role: "manifest" | "config" | "lock" | "database" | "metadata";
	size: number;
	sha256: string;
}

export interface FullBackupManifest {
	format: "qingyan.full-backup";
	formatVersion: 1;
	createdAt: string;
	qingyanVersion: string;
	database: {
		client: "sqlite";
		backupStrategy: "sqlite_backup_api";
		applicationVersion: string;
		schemaVersion: string | null;
		upgradeState: string;
	};
	config: {
		path: string;
		publicBaseUrl: string;
		adminConsolePath: string | null;
	};
	service: {
		unit: string;
	};
	environment: {
		detected: Array<{
			name: string;
			category: string;
			secret: boolean;
			included: false;
		}>;
	};
	files: FullBackupFileManifest[];
}

export interface FullBackupResult {
	outputDirectory: string;
	manifestPath: string;
	manifest: FullBackupManifest;
}

function displayPath(filePath: string): string {
	const relative = path.relative(process.cwd(), filePath);
	return relative.startsWith("..") ? filePath : relative;
}

function fileHash(filePath: string): string {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function fileManifest(
	role: FullBackupFileManifest["role"],
	backupRoot: string,
	filePath: string,
): FullBackupFileManifest {
	const stat = statSync(filePath);
	return {
		role,
		path: path.relative(backupRoot, filePath).replaceAll("\\", "/"),
		size: stat.size,
		sha256: fileHash(filePath),
	};
}

function latestMigration(sqlite: SqliteClient): string | null {
	const table = sqlite
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
		.get("__qingyan_migrations");
	if (!table) {
		return null;
	}
	const row = sqlite
		.prepare(
			"SELECT name FROM __qingyan_migrations ORDER BY applied_at DESC LIMIT 1",
		)
		.get() as { name?: string } | undefined;
	return row?.name ?? null;
}

function adminConsolePath(sqlite: SqliteClient): string | null {
	const table = sqlite
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
		.get("admin_bootstrap_state");
	if (!table) {
		return null;
	}
	const row = sqlite
		.prepare("SELECT console_path FROM admin_bootstrap_state WHERE id = 1")
		.get() as { console_path?: string } | undefined;
	return row?.console_path ?? null;
}

function latestUpgradeState(sqlite: SqliteClient): string {
	const table = sqlite
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
		.get("__qingyan_upgrades");
	if (!table) {
		return "upgrade_required";
	}
	return "normal_current";
}

function detectedEnvironment(environment: NodeJS.ProcessEnv) {
	return envMappings
		.filter((mapping) => environment[mapping.envName] !== undefined)
		.map((mapping) => ({
			name: mapping.envName,
			category: mapping.category,
			secret: mapping.secret,
			included: false as const,
		}));
}

export class FullBackupService {
	public constructor(
		private readonly options: {
			configPath: string;
			config: AppConfig;
			databaseFile: string;
			sqlite: SqliteClient;
			packageVersion: string;
			env?: NodeJS.ProcessEnv;
			now?: () => Date;
			serviceUnit?: string;
		},
	) {}

	public buildManifest(files: FullBackupFileManifest[]): FullBackupManifest {
		return {
			format: "qingyan.full-backup",
			formatVersion: 1,
			createdAt: (this.options.now?.() ?? new Date()).toISOString(),
			qingyanVersion: this.options.packageVersion,
			database: {
				client: "sqlite",
				backupStrategy: "sqlite_backup_api",
				applicationVersion: this.options.packageVersion,
				schemaVersion: latestMigration(this.options.sqlite),
				upgradeState: latestUpgradeState(this.options.sqlite),
			},
			config: {
				path: displayPath(this.options.configPath),
				publicBaseUrl: this.options.config.server.publicBaseUrl,
				adminConsolePath: adminConsolePath(this.options.sqlite),
			},
			service: {
				unit: this.options.serviceUnit ?? "qingyan.service",
			},
			environment: {
				detected: detectedEnvironment(this.options.env ?? process.env),
			},
			files,
		};
	}

	public async createBackup(input: {
		outputPath: string;
	}): Promise<FullBackupResult> {
		const outputDirectory = input.outputPath.endsWith(".qingyan-backup")
			? input.outputPath
			: `${input.outputPath}.qingyan-backup`;
		const configDirectory = path.join(outputDirectory, "config");
		const databaseDirectory = path.join(outputDirectory, "database");
		const metadataDirectory = path.join(outputDirectory, "metadata");
		mkdirSync(configDirectory, { recursive: true });
		mkdirSync(databaseDirectory, { recursive: true });
		mkdirSync(metadataDirectory, { recursive: true });

		const copiedFiles: FullBackupFileManifest[] = [];
		const configBackupPath = path.join(configDirectory, "qingyan.yml");
		copyFileSync(this.options.configPath, configBackupPath);
		copiedFiles.push(fileManifest("config", outputDirectory, configBackupPath));

		const lockPath = resolveInstallLockPath(this.options.configPath);
		if (existsSync(lockPath)) {
			const lockBackupPath = path.join(
				configDirectory,
				"qingyan.installed.lock",
			);
			copyFileSync(lockPath, lockBackupPath);
			copiedFiles.push(fileManifest("lock", outputDirectory, lockBackupPath));
		}

		const databaseBackupPath = path.join(databaseDirectory, "qingyan.sqlite");
		await this.options.sqlite.backup(databaseBackupPath);
		copiedFiles.push(
			fileManifest("database", outputDirectory, databaseBackupPath),
		);

		const checksumsPath = path.join(metadataDirectory, "checksums.json");
		writeFileSync(
			checksumsPath,
			`${JSON.stringify(copiedFiles, null, 2)}\n`,
			"utf-8",
		);
		copiedFiles.push(fileManifest("metadata", outputDirectory, checksumsPath));

		const manifest = this.buildManifest(copiedFiles);
		const manifestPath = path.join(outputDirectory, "manifest.json");
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		manifest.files.push(
			fileManifest("manifest", outputDirectory, manifestPath),
		);
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

		return {
			outputDirectory,
			manifestPath,
			manifest,
		};
	}
}
