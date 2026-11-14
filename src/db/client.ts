import { getTableColumns, is, Table } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig, types } from "pg";

import * as schema from "./schema";
import { toSafeInteger, toUtcTimestamp } from "./values";

// Drizzle 在查询级覆盖 parser；使用原始 JSON 文本才能区分 SQL NULL 和 JSON null。
types.setTypeParser(types.builtins.JSON, (value) => value);
types.setTypeParser(types.builtins.JSONB, (value) => value);

export type AppDatabase = NodePgDatabase<typeof schema>;
export type AppTransaction = Parameters<
	Parameters<AppDatabase["transaction"]>[0]
>[0];
export type DatabaseExecutor = AppDatabase | AppTransaction;

export interface DatabaseOptions {
	pool?: { max?: number; connectionTimeoutMs?: number; idleTimeoutMs?: number };
	tls?: Exclude<PoolConfig["ssl"], boolean | undefined>;
	onPoolError?: (error: Error) => void;
}

export interface DatabaseClients {
	pool: Pool;
	db: AppDatabase;
	close(): Promise<void>;
}

for (const table of Object.values(schema)) {
	if (!is(table, Table)) continue;
	for (const column of Object.values(getTableColumns(table))) {
		if (column.getSQLType() !== "bigint") continue;
		column.mapFromDriverValue = toSafeInteger;
		column.mapToDriverValue = toSafeInteger;
	}
}

export function createDatabaseClients(
	databaseUrl: string,
	options: DatabaseOptions = {},
): DatabaseClients {
	const pool = new Pool({
		connectionString: databaseUrl,
		max: options.pool?.max ?? 5,
		connectionTimeoutMillis: options.pool?.connectionTimeoutMs ?? 5_000,
		idleTimeoutMillis: options.pool?.idleTimeoutMs ?? 30_000,
		options: "-c timezone=UTC -c datestyle=ISO,YMD",
		ssl: options.tls,
		types: {
			getTypeParser: (oid, format) => {
				if (format !== "binary" && oid === types.builtins.INT8)
					return toSafeInteger;
				if (format !== "binary" && oid === types.builtins.TIMESTAMPTZ)
					return toUtcTimestamp;
				return types.getTypeParser(oid, format);
			},
		},
	});
	pool.on("error", options.onPoolError ?? (() => {}));
	const db = drizzle(pool, { schema });
	return { pool, db, close: () => pool.end() };
}
