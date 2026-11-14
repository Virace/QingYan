import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Pool, PoolClient } from "pg";

export const DEFAULT_MIGRATION_DIRECTORY = path.resolve(
	process.cwd(),
	"drizzle",
	"postgresql",
);

export interface DatabaseMigration {
	name: string;
	checksum: string;
	sql: string;
}

export async function readDatabaseMigrations(
	migrationDirectory = DEFAULT_MIGRATION_DIRECTORY,
): Promise<DatabaseMigration[]> {
	const names = (await readdir(migrationDirectory))
		.filter((name) => name.endsWith(".sql"))
		.sort();
	return Promise.all(
		names.map(async (name) => {
			const sql = await readFile(path.join(migrationDirectory, name), "utf8");
			return {
				name,
				sql,
				checksum: createHash("sha256").update(sql).digest("hex"),
			};
		}),
	);
}

export interface DatabaseMigrationState {
	applied: string[];
	pending: string[];
	unknown: string[];
	checksumMismatches: string[];
}

async function readAppliedMigrations(
	client: Pick<PoolClient, "query">,
): Promise<Array<{ name: string; checksum: string }>> {
	const exists = await client.query<{ exists: boolean }>(
		"SELECT to_regclass('public.__qingyan_migrations') IS NOT NULL AS exists",
	);
	if (!exists.rows[0]?.exists) return [];
	const records = await client.query<{ name: string; checksum: string }>(
		"SELECT name, checksum FROM public.__qingyan_migrations ORDER BY name",
	);
	return records.rows;
}

export async function getDatabaseMigrationState(
	pool: Pool,
	migrationDirectory = DEFAULT_MIGRATION_DIRECTORY,
): Promise<DatabaseMigrationState> {
	const migrations = await readDatabaseMigrations(migrationDirectory);
	const applied = await readAppliedMigrations(pool);
	const names = new Set(migrations.map((migration) => migration.name));
	const appliedByName = new Map(
		applied.map((migration) => [migration.name, migration.checksum]),
	);
	return {
		applied: applied.map((migration) => migration.name),
		pending: migrations
			.filter((migration) => !appliedByName.has(migration.name))
			.map((migration) => migration.name),
		unknown: applied
			.filter((migration) => !names.has(migration.name))
			.map((migration) => migration.name),
		checksumMismatches: migrations
			.filter(
				(migration) =>
					appliedByName.has(migration.name) &&
					appliedByName.get(migration.name) !== migration.checksum,
			)
			.map((migration) => migration.name),
	};
}

/** 所有结构变更与账本在同一连接和事务中完成；转换开始记录可随基线原子提交。 */
export async function applyDatabaseMigrations(
	pool: Pool,
	migrationDirectory = DEFAULT_MIGRATION_DIRECTORY,
	options: { afterMigrate?: (client: PoolClient) => Promise<void> } = {},
): Promise<void> {
	const migrations = await readDatabaseMigrations(migrationDirectory);
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query(
			"SELECT pg_advisory_xact_lock(7104345432742244::bigint)",
		);
		await client.query(`CREATE TABLE IF NOT EXISTS public.__qingyan_migrations (
   name text COLLATE "C" PRIMARY KEY,
   checksum text NOT NULL,
   applied_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
		const applied = await readAppliedMigrations(client);
		const available = new Map(
			migrations.map((migration) => [migration.name, migration]),
		);
		for (const record of applied) {
			const migration = available.get(record.name);
			if (!migration) throw new Error("DATABASE_SCHEMA_NEWER_THAN_APPLICATION");
			if (migration.checksum !== record.checksum)
				throw new Error("DATABASE_MIGRATION_CHECKSUM_MISMATCH");
		}
		const appliedNames = new Set(applied.map((migration) => migration.name));
		for (const migration of migrations) {
			if (appliedNames.has(migration.name)) continue;
			for (const statement of migration.sql
				.split("--> statement-breakpoint")
				.map((sql) => sql.trim())
				.filter(Boolean)) {
				await client.query(statement);
			}
			await client.query(
				"INSERT INTO public.__qingyan_migrations (name, checksum) VALUES ($1, $2)",
				[migration.name, migration.checksum],
			);
		}
		await options.afterMigrate?.(client);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
