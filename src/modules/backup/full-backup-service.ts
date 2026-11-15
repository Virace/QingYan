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
import type { Pool } from "pg";
import { envMappings } from "../../config/env-mapping";
import type { AppConfig } from "../../config/types";
import {
	backupDatabaseResources,
	databaseIdentity,
	runPostgresTool,
} from "../database-backup/postgres-tools";
import { resolveInstallLockPath } from "../install/state";
import { resolvePartialUpgradeMarkerPath } from "../upgrade/partial-marker";
import { detectUpgradeRuntimeState } from "../upgrade/state";

export interface FullBackupFileManifest {
	path: string;
	role:
		| "manifest"
		| "config"
		| "lock"
		| "database"
		| "metadata"
		| "resource"
		| "plan";
	ipVersion?: string;
	resourceOwner?: "settings" | "state" | "both";
	size: number;
	sha256: string;
}

export interface FullBackupManifest {
	format: "qingyan.full-backup";
	formatVersion: 1;
	createdAt: string;
	qingyanVersion: string;
	database: {
		client: "postgresql";
		backupStrategy: "pg_dump_custom";
		serverVersion: string;
		applicationVersion: string;
		targetIdentity: string;
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
	upgrade?: { fromVersion: string; toVersion: string };
	success: true;
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
			pool: Pool;
			packageVersion: string;
			env?: NodeJS.ProcessEnv;
			now?: () => Date;
			serviceUnit?: string;
		},
	) {}

	public async buildManifest(
		files: FullBackupFileManifest[],
	): Promise<FullBackupManifest> {
		const migration = await this.options.pool.query<{
			name: string;
			server_version: string;
		}>(
			"SELECT name,current_setting('server_version') AS server_version FROM __qingyan_migrations ORDER BY name DESC LIMIT 1",
		);
		const bootstrap = await this.options.pool.query<{ console_path: string }>(
			"SELECT console_path FROM admin_bootstrap_state WHERE id=1",
		);
		return {
			format: "qingyan.full-backup",
			formatVersion: 1,
			createdAt: (this.options.now?.() ?? new Date()).toISOString(),
			qingyanVersion: this.options.packageVersion,
			database: {
				client: "postgresql",
				backupStrategy: "pg_dump_custom",
				serverVersion: migration.rows[0]?.server_version ?? "unknown",
				applicationVersion: this.options.packageVersion,
				targetIdentity: databaseIdentity(this.options.config.database.url),
				schemaVersion: migration.rows[0]?.name ?? null,
				upgradeState: (
					await detectUpgradeRuntimeState({
						configPath: this.options.configPath,
						loadedConfig: this.options.config,
						currentApplicationVersion: this.options.packageVersion,
						partialUpgradeMarkerPath: resolvePartialUpgradeMarkerPath(
							this.options.configPath,
						),
					})
				).state,
			},
			config: {
				path: displayPath(this.options.configPath),
				publicBaseUrl: this.options.config.server.publicBaseUrl,
				adminConsolePath: bootstrap.rows[0]?.console_path ?? null,
			},
			service: {
				unit: this.options.serviceUnit ?? "qingyan.service",
			},
			environment: {
				detected: detectedEnvironment(this.options.env ?? process.env),
			},
			files,
			success: true,
		};
	}

	public async createBackup(input: {
		outputPath: string;
	}): Promise<FullBackupResult> {
		const outputDirectory = input.outputPath.endsWith(".qingyan-backup")
			? input.outputPath
			: `${input.outputPath}.qingyan-backup`;
		return this.createBackupPackage({ outputDirectory });
	}

	public async createBackupPackage(input: {
		outputDirectory: string;
		upgrade?: { fromVersion: string; toVersion: string; plan: unknown };
	}): Promise<FullBackupResult> {
		const outputDirectory = input.outputDirectory;
		const configDirectory = path.join(outputDirectory, "config");
		const databaseDirectory = path.join(outputDirectory, "database");
		const metadataDirectory = path.join(outputDirectory, "metadata");
		mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
		mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
		mkdirSync(databaseDirectory, { recursive: true });
		mkdirSync(metadataDirectory, { recursive: true });

		const copiedFiles: FullBackupFileManifest[] = [];
		if (input.upgrade) {
			const planPath = path.join(outputDirectory, "upgrade-plan.json");
			writeFileSync(planPath, JSON.stringify(input.upgrade.plan, null, 2), {
				mode: 0o600,
			});
			copiedFiles.push(fileManifest("plan", outputDirectory, planPath));
		}
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

		const databaseBackupPath = path.join(databaseDirectory, "qingyan.dump");
		await runPostgresTool(
			"pg_dump",
			["-Fc", "--no-owner", "--no-acl", "--file", databaseBackupPath],
			this.options.config.database,
			path.join(configDirectory, "credentials"),
		);
		copiedFiles.push(
			fileManifest("database", outputDirectory, databaseBackupPath),
		);

		for (const resource of await backupDatabaseResources(
			this.options.pool,
			path.join(outputDirectory, "resources"),
		)) {
			copiedFiles.push({
				...fileManifest("resource", outputDirectory, resource.path),
				ipVersion: resource.ipVersion,
				resourceOwner: resource.resourceOwner,
			});
		}

		const checksumsPath = path.join(metadataDirectory, "checksums.json");
		writeFileSync(
			checksumsPath,
			`${JSON.stringify(copiedFiles, null, 2)}\n`,
			"utf-8",
		);
		copiedFiles.push(fileManifest("metadata", outputDirectory, checksumsPath));

		const manifest = await this.buildManifest(copiedFiles);
		if (input.upgrade)
			manifest.upgrade = {
				fromVersion: input.upgrade.fromVersion,
				toVersion: input.upgrade.toVersion,
			};
		const manifestPath = path.join(outputDirectory, "manifest.json");
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

		return {
			outputDirectory,
			manifestPath,
			manifest,
		};
	}
}
