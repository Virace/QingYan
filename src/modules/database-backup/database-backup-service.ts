import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/load-config";
import type { AppConfig, StartupConfig } from "../../config/types";
import { createDatabaseClients } from "../../db/client";
import { FullBackupService } from "../backup/full-backup-service";
import { databaseIdentity } from "./postgres-tools";

export interface DatabaseBackupFile {
	role: "database" | "config" | "plan" | "metadata" | "resource" | "lock";
	path: string;
	backupPath: string | null;
	present: boolean;
	size: number | null;
	sha256: string | null;
}
export interface DatabaseBackupResult {
	kind: "upgrade_database_backup";
	engine: "postgresql";
	strategy: "pg_dump_custom";
	serverVersion: string;
	createdAt: string;
	backupDirectory: string;
	databaseBackupPath: string;
	manifestPath: string;
	files: DatabaseBackupFile[];
	notes: string[];
}
export class DatabaseBackupService {
	constructor(
		private readonly input: {
			database: StartupConfig["database"];
			config?: AppConfig;
			now?: () => Date;
			backupRoot?: string;
		},
	) {}
	async createUpgradeBackup(input: {
		upgradeId: string;
		fromVersion: string;
		toVersion: string;
		configPath: string;
		plan: unknown;
		partialMarkerPath: string;
		backupDirectory?: string;
	}): Promise<DatabaseBackupResult> {
		const backupDirectory = path.resolve(
			input.backupDirectory ??
				path.join(
					this.input.backupRoot ?? "data/backups/upgrades",
					input.upgradeId,
				),
		);
		const config = this.input.config ?? (await loadConfig(input.configPath));
		const clients = createDatabaseClients(
			this.input.database.url,
			this.input.database,
		);
		try {
			const backup = await new FullBackupService({
				configPath: input.configPath,
				config: { ...config, database: this.input.database },
				pool: clients.pool,
				packageVersion: input.fromVersion,
				now: this.input.now,
			}).createBackupPackage({
				outputDirectory: backupDirectory,
				upgrade: {
					fromVersion: input.fromVersion,
					toVersion: input.toVersion,
					plan: input.plan,
				},
			});
			const result: DatabaseBackupResult = {
				kind: "upgrade_database_backup",
				engine: "postgresql",
				strategy: "pg_dump_custom",
				serverVersion: backup.manifest.database.serverVersion,
				createdAt: backup.manifest.createdAt,
				backupDirectory,
				databaseBackupPath: path.join(backupDirectory, "database/qingyan.dump"),
				manifestPath: backup.manifestPath,
				files: backup.manifest.files.map((file) => ({
					role: file.role as DatabaseBackupFile["role"],
					path: path.join(backupDirectory, file.path),
					backupPath: path.join(backupDirectory, file.path),
					present: true,
					size: file.size,
					sha256: file.sha256,
				})),
				notes: [
					"停写后生成的 PostgreSQL custom dump 为恢复主文件。",
					"使用 qyctl restore 读取 manifest.json，恢复到预建空数据库。",
					"配置与备份含凭据，应限制备份目录访问权限。",
				],
			};
			writeFileSync(
				path.join(backupDirectory, "metadata.json"),
				JSON.stringify(
					{
						...result,
						target: databaseIdentity(this.input.database.url),
						fromVersion: input.fromVersion,
						toVersion: input.toVersion,
						success: true,
					},
					null,
					2,
				),
				{ mode: 0o600 },
			);
			return result;
		} finally {
			await clients.close();
		}
	}
}
