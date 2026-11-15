import { randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { configSchema, type StartupConfig } from "../../config/types";
import { createDatabaseClients } from "../../db/client";
import { getDatabaseMigrationState } from "../../db/migrations";
import {
	databaseIdentity,
	runPostgresTool,
} from "../database-backup/postgres-tools";
import {
	assertRestoreFile,
	prepareRestoreDirectory,
	publishRestoreConfig,
	restoreHash,
	stageRestoreFile,
} from "./restore-artifacts";

const manifestSchema = z.object({
	format: z.literal("qingyan.full-backup"),
	formatVersion: z.literal(1),
	qingyanVersion: z.string().min(1),
	database: z.object({ client: z.literal("postgresql") }),
	files: z.array(
		z.object({
			path: z.string().min(1),
			role: z.enum([
				"manifest",
				"config",
				"lock",
				"database",
				"metadata",
				"resource",
				"plan",
			]),
			sha256: z.string().regex(/^[a-f0-9]{64}$/),
			ipVersion: z.enum(["v4", "v6"]).optional(),
			resourceOwner: z.enum(["settings", "state", "both"]).default("both"),
		}),
	),
});

const targetRelationsQuery = `SELECT 1 FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1`;

function sqlLiteral(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

const restoreReceiptDefinition = `CREATE TABLE IF NOT EXISTS public.__qingyan_restore_receipts (id text PRIMARY KEY, request_hash text NOT NULL);
DO $$ BEGIN
IF NOT EXISTS (
 SELECT 1 FROM pg_class WHERE oid='public.__qingyan_restore_receipts'::regclass AND relkind='r'
) OR (
 SELECT array_agg(attname::text || ':' || format_type(atttypid,atttypmod) || ':' || attnotnull::text ORDER BY attnum)
 FROM pg_attribute WHERE attrelid='public.__qingyan_restore_receipts'::regclass AND attnum>0 AND NOT attisdropped
) IS DISTINCT FROM ARRAY['id:text:true','request_hash:text:true']::text[] OR NOT EXISTS (
 SELECT 1 FROM pg_constraint WHERE conrelid='public.__qingyan_restore_receipts'::regclass AND contype='p' AND conkey=ARRAY[1]::smallint[]
) THEN RAISE EXCEPTION 'RESTORE_RECEIPT_SCHEMA_INVALID'; END IF;
END $$;`;

export interface RestorePlan {
	backupVersion: string;
	currentVersion: string;
	databaseClient: string;
	configPath: string;
	upgradeRequired: boolean;
	backupRoot: string;
}

export class RestoreService {
	constructor(
		private readonly options: {
			currentVersion: string;
			currentConfigPath: string;
		},
	) {}

	private readBackup(backupPath: string) {
		const manifestPath = backupPath.endsWith("manifest.json")
			? backupPath
			: path.join(backupPath, "manifest.json");
		const manifest = manifestSchema.parse(
			JSON.parse(readFileSync(manifestPath, "utf8")),
		);
		const root = realpathSync(path.dirname(manifestPath));
		const resolveFile = (relative: string) => {
			if (
				path.win32.isAbsolute(relative) ||
				path.posix.isAbsolute(relative) ||
				relative.split(/[\\/]/).includes("..")
			)
				throw new Error("RESTORE_BACKUP_PATH_INVALID");
			const resolved = realpathSync(path.resolve(root, relative));
			const relation = path.relative(root, resolved);
			if (
				relation === ".." ||
				relation.startsWith(`..${path.sep}`) ||
				path.isAbsolute(relation) ||
				!lstatSync(resolved).isFile()
			)
				throw new Error("RESTORE_BACKUP_PATH_INVALID");
			return resolved;
		};
		const paths = new Set<string>();
		for (const file of manifest.files.filter(
			(file) => file.role !== "manifest",
		)) {
			const resolved = resolveFile(file.path);
			if (paths.has(resolved)) throw new Error("RESTORE_BACKUP_DUPLICATE_FILE");
			paths.add(resolved);
			if (restoreHash(readFileSync(resolved)) !== file.sha256)
				throw new Error("RESTORE_CHECKSUM_MISMATCH");
		}
		return { manifest, root, resolveFile };
	}

	plan(input: { backupPath: string }): RestorePlan {
		const { manifest, root } = this.readBackup(input.backupPath);
		return {
			backupVersion: manifest.qingyanVersion,
			currentVersion: this.options.currentVersion,
			databaseClient: manifest.database.client,
			configPath: this.options.currentConfigPath,
			upgradeRequired: manifest.qingyanVersion !== this.options.currentVersion,
			backupRoot: root,
		};
	}

	async apply(input: {
		backupPath: string;
		database: StartupConfig["database"];
		outputConfigPath: string;
		confirm: string;
	}): Promise<{
		configPath: string;
		targetIdentity: string;
		configurationSwitched: false;
	}> {
		if (input.confirm !== "RESTORE QINGYAN")
			throw new Error("RESTORE_CONFIRMATION_REQUIRED");
		const backup = this.readBackup(input.backupPath);
		const outputPath = path.resolve(input.outputConfigPath);
		if (outputPath === path.resolve(this.options.currentConfigPath))
			throw new Error("RESTORE_CONFIG_SWITCH_SEPARATE");
		const dumps = backup.manifest.files.filter(
			(file) => file.role === "database",
		);
		const configs = backup.manifest.files.filter(
			(file) => file.role === "config",
		);
		if (dumps.length !== 1 || configs.length !== 1)
			throw new Error("RESTORE_BACKUP_INCOMPLETE");
		const dump = dumps[0];
		const configFile = configs[0];
		const config = configSchema.parse({
			...parse(readFileSync(backup.resolveFile(configFile.path), "utf8")),
			database: input.database,
		});
		const configContents = stringify(config);
		const resources = backup.manifest.files
			.filter((file) => file.role === "resource")
			.map((resource) => {
				if (!resource.ipVersion)
					throw new Error("RESTORE_RESOURCE_VERSION_REQUIRED");
				return { ...resource, ipVersion: resource.ipVersion };
			});
		const owners = new Set<string>();
		for (const resource of resources) {
			for (const owner of resource.resourceOwner === "both"
				? ["settings", "state"]
				: [resource.resourceOwner]) {
				const key = `${resource.ipVersion}:${owner}`;
				if (owners.has(key))
					throw new Error("RESTORE_RESOURCE_DUPLICATE_OWNER");
				owners.add(key);
			}
		}
		// 文件解析、目标目录与资源准备均先于数据库写入；不依赖 TLS 凭据目录的副作用。
		mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
		const canonicalOutput = path.join(
			realpathSync(path.dirname(outputPath)),
			path.basename(outputPath),
		);
		const requestHash = restoreHash(
			JSON.stringify({
				manifest: backup.manifest,
				config: configContents,
				outputPath: canonicalOutput,
				version: this.options.currentVersion,
			}),
		);
		const state = prepareRestoreDirectory(canonicalOutput, requestHash);
		const stagedConfig = path.join(state.directory, "qingyan.yml");
		stageRestoreFile(stagedConfig, configContents);
		if (lstatSync(canonicalOutput, { throwIfNoEntry: false })) {
			if (!state.isRetry) throw new Error("RESTORE_OUTPUT_CONFIG_EXISTS");
			assertRestoreFile(canonicalOutput, restoreHash(configContents));
		}
		const resourceUpdates: string[] = [];
		for (const resource of resources) {
			const resourcePath = path.join(
				state.directory,
				"resources",
				`ip2region_${resource.ipVersion}${resource.resourceOwner === "state" ? "_state" : ""}.xdb`,
			);
			stageRestoreFile(
				resourcePath,
				readFileSync(backup.resolveFile(resource.path)),
			);
			if (resource.resourceOwner !== "settings")
				resourceUpdates.push(
					`UPDATE public.ip_region_database_state SET file_path=${sqlLiteral(resourcePath)} WHERE ip_version=${sqlLiteral(resource.ipVersion)};`,
				);
			if (resource.resourceOwner !== "state")
				resourceUpdates.push(
					`INSERT INTO public.system_settings(category,key,value_json) VALUES('ipRegion',${sqlLiteral(`${resource.ipVersion === "v4" ? "ipv4" : "ipv6"}.dbPath`)},${sqlLiteral(JSON.stringify(resourcePath))}::jsonb) ON CONFLICT(category,key) DO UPDATE SET value_json=EXCLUDED.value_json;`,
				);
		}

		const clients = createDatabaseClients(config.database.url, config.database);
		try {
			const receiptTable = await clients.pool.query<{ exists: boolean }>(
				"SELECT to_regclass('public.__qingyan_restore_receipts') IS NOT NULL AS exists",
			);
			let restored = false;
			if (receiptTable.rows[0]?.exists && state.isRetry) {
				const receipt = await clients.pool.query<{ request_hash: string }>(
					"SELECT request_hash FROM public.__qingyan_restore_receipts WHERE id=$1",
					[state.marker.id],
				);
				if (receipt.rowCount) {
					if (receipt.rowCount !== 1)
						throw new Error("RESTORE_RECEIPT_INVALID");
					if (receipt.rows[0]?.request_hash !== requestHash)
						throw new Error("RESTORE_RECOVERY_REQUEST_MISMATCH");
					restored = true;
				}
			}
			if (!restored) {
				if ((await clients.pool.query(targetRelationsQuery)).rowCount)
					throw new Error("RESTORE_TARGET_NOT_EMPTY");
				if (existsSync(canonicalOutput))
					throw new Error("RESTORE_RECOVERY_DATABASE_MISSING");
				const attempt = randomUUID();
				const databaseSql = path.join(
					state.directory,
					`database-${attempt}.sql`,
				);
				writeFileSync(databaseSql, "", { mode: 0o600, flag: "wx" });
				await runPostgresTool(
					"pg_restore",
					[
						"--no-owner",
						"--no-acl",
						"--exit-on-error",
						"--file",
						databaseSql,
						backup.resolveFile(dump.path),
					],
					config.database,
					path.join(state.directory, "credentials"),
				);
				const prelude = path.join(state.directory, "before-restore.sql");
				stageRestoreFile(
					prelude,
					`SELECT pg_advisory_xact_lock(174007, 4);\nDO $$ BEGIN IF EXISTS (${targetRelationsQuery}) THEN RAISE EXCEPTION 'RESTORE_TARGET_NOT_EMPTY'; END IF; END $$;\n`,
				);
				const completion = path.join(state.directory, "complete-restore.sql");
				stageRestoreFile(
					completion,
					`SET LOCAL standard_conforming_strings = on;\n${resourceUpdates.join("\n")}\n${restoreReceiptDefinition}\nINSERT INTO public.__qingyan_restore_receipts(id,request_hash) VALUES(${sqlLiteral(state.marker.id)},${sqlLiteral(requestHash)});\n`,
				);
				// 收据与导入、资源路径在同一事务提交，进程退出后仍能辨认提交事实。
				await runPostgresTool(
					"psql",
					[
						"--no-psqlrc",
						"--single-transaction",
						"--set",
						"ON_ERROR_STOP=on",
						"--file",
						prelude,
						"--file",
						databaseSql,
						"--file",
						completion,
					],
					config.database,
					path.join(state.directory, "credentials"),
				);
			}
			const migration = await getDatabaseMigrationState(clients.pool);
			if (migration.unknown.length || migration.checksumMismatches.length)
				throw new Error("RESTORE_DATABASE_VERSION_INVALID");
			const initialized = await clients.pool.query(
				"SELECT 1 FROM public.admin_bootstrap_state WHERE id=1",
			);
			if (!initialized.rowCount) throw new Error("RESTORE_DATABASE_INCOMPLETE");
			publishRestoreConfig(stagedConfig, canonicalOutput);
			return {
				configPath: input.outputConfigPath,
				targetIdentity: databaseIdentity(config.database.url),
				configurationSwitched: false,
			};
		} finally {
			await clients.close();
		}
	}
}
