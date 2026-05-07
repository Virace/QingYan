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

import type { SqliteClient } from "../../db/client";

export type DatabaseBackupKind =
	| "import_database_backup"
	| "upgrade_database_backup";

export interface DatabaseBackupFile {
	role: "database" | "wal" | "shm" | "metadata";
	path: string;
	backupPath: string | null;
	present: boolean;
	size: number | null;
	sha256: string | null;
}

export interface DatabaseBackupResult {
	kind: DatabaseBackupKind;
	engine: "sqlite";
	strategy: "sqlite_backup_api";
	createdAt: string;
	backupDirectory: string;
	databaseBackupPath: string;
	files: DatabaseBackupFile[];
	notes: string[];
}

export class DatabaseBackupService {
	public constructor(
		private readonly input: {
			engine: string;
			databaseFile: string;
			sqlite: SqliteClient;
			backupRoot?: string;
			now?: () => Date;
		},
	) {}

	public async createImportBackup(input: {
		jobId: string;
		siteId: number;
		sourceType: string;
	}): Promise<DatabaseBackupResult> {
		if (this.input.engine !== "sqlite") {
			throw new Error("DATABASE_BACKUP_ENGINE_UNSUPPORTED");
		}

		const createdAt = (this.input.now?.() ?? new Date()).toISOString();
		const backupDirectory = path.join(
			this.input.backupRoot ??
				path.join(path.dirname(this.input.databaseFile), "backups", "imports"),
			input.jobId,
		);
		mkdirSync(backupDirectory, { recursive: true });

		const stamp = createdAt.replace(/\D/g, "").slice(0, 14);
		const databaseBackupPath = path.join(
			backupDirectory,
			`${path.basename(this.input.databaseFile)}.bak-${stamp}`,
		);
		await this.input.sqlite.backup(databaseBackupPath);

		const walPath = `${this.input.databaseFile}-wal`;
		const shmPath = `${this.input.databaseFile}-shm`;
		const files = [
			this.fileMetadata(
				"database",
				this.input.databaseFile,
				databaseBackupPath,
			),
			this.copyOptional("wal", walPath, backupDirectory, stamp),
			this.copyOptional("shm", shmPath, backupDirectory, stamp),
		];
		const result: DatabaseBackupResult = {
			kind: "import_database_backup",
			engine: "sqlite",
			strategy: "sqlite_backup_api",
			createdAt,
			backupDirectory: this.displayPath(backupDirectory),
			databaseBackupPath: this.displayPath(databaseBackupPath),
			files,
			notes: [
				"SQLite backup API output is the primary restore file.",
				"WAL/SHM files are copied when present for diagnostics.",
			],
		};
		const metadataPath = path.join(backupDirectory, "metadata.json");
		writeFileSync(metadataPath, JSON.stringify({ ...result, input }, null, 2));
		result.files.push(
			this.fileMetadata("metadata", metadataPath, metadataPath),
		);
		return result;
	}

	private copyOptional(
		role: "wal" | "shm",
		filePath: string,
		backupDirectory: string,
		stamp: string,
	): DatabaseBackupFile {
		if (!existsSync(filePath)) {
			return {
				role,
				path: this.displayPath(filePath),
				backupPath: null,
				present: false,
				size: null,
				sha256: null,
			};
		}

		const backupPath = path.join(
			backupDirectory,
			`${path.basename(filePath)}.bak-${stamp}`,
		);
		copyFileSync(filePath, backupPath);
		return this.fileMetadata(role, filePath, backupPath);
	}

	private fileMetadata(
		role: DatabaseBackupFile["role"],
		filePath: string,
		backupPath: string,
	): DatabaseBackupFile {
		const stat = statSync(backupPath);
		return {
			role,
			path: this.displayPath(filePath),
			backupPath: this.displayPath(backupPath),
			present: true,
			size: stat.size,
			sha256: createHash("sha256")
				.update(readFileSync(backupPath))
				.digest("hex"),
		};
	}

	private displayPath(filePath: string) {
		const relative = path.relative(process.cwd(), filePath);
		return relative.startsWith("..") ? filePath : relative;
	}
}
