import Database from "better-sqlite3";
import {
	drizzle,
	type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;
export type SqliteClient = InstanceType<typeof Database>;

export interface DatabaseClients {
	sqlite: SqliteClient;
	db: AppDatabase;
}

export function createDatabaseClients(databaseFile: string): DatabaseClients {
	const sqlite = new Database(databaseFile);
	sqlite.pragma("foreign_keys = ON");
	sqlite.pragma("journal_mode = WAL");

	const db = drizzle(sqlite, {
		schema,
	});

	return { sqlite, db };
}
