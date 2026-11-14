import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	chmod,
	copyFile,
	mkdir,
	readFile,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { SOURCE_COLUMNS } from "./source-columns";

export type SourceRow = Record<
	string,
	string | number | bigint | null | Uint8Array
>;

export const ARCHIVED_TABLES = new Set([
	"admin_group_permissions",
	"site_notification_recipients",
	"site_notification_recipient_routes",
	"ip_region_update_runs",
	"import_batches",
	"import_records",
	"__qingyan_migrations",
]);

export const INLINE_METADATA: Record<string, string> = {
	author_ip: "author_ip",
	author_user_agent: "author_user_agent",
	...Object.fromEntries(
		[
			"ip_country",
			"ip_region",
			"ip_city",
			"ip_isp",
			"ip_location_raw",
			"ip_location_source",
			"ip_location_db_hash",
			"ip_location_updated_at",
			"ip_location_error",
			"device_browser",
			"device_browser_version",
			"device_os",
			"device_os_version",
			"device_type",
			"device_icon",
			"device_source",
			"device_parser_version",
			"device_updated_at",
			"device_error",
		].map((field) => [`author_${field}`, field]),
	),
};

export function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

export async function checksum(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) hash.update(chunk);
	return hash.digest("hex");
}

export async function writeProtectedJson(filePath: string, value: unknown) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
		mode: 0o600,
	});
	await chmod(filePath, 0o600);
}

export class SqliteSource {
	readonly database: DatabaseSync;
	constructor(readonly filePath: string) {
		this.database = new DatabaseSync(filePath, { readOnly: true });
		this.database.exec("PRAGMA query_only = ON");
	}
	close() {
		this.database.close();
	}
	rows(table: string): SourceRow[] {
		return this.database
			.prepare(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY rowid`)
			.all() as SourceRow[];
	}
	*pages(table: string, size = 250): Generator<SourceRow[]> {
		let lastRowId: number | null = null;
		const firstPage = this.database.prepare(
			`SELECT rowid AS __source_rowid, * FROM ${quoteIdentifier(table)} ORDER BY rowid LIMIT ?`,
		);
		const statement = this.database.prepare(
			`SELECT rowid AS __source_rowid, * FROM ${quoteIdentifier(table)} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
		);
		for (;;) {
			const rows = (
				lastRowId === null
					? firstPage.all(size)
					: statement.all(lastRowId, size)
			) as SourceRow[];
			if (rows.length === 0) break;
			lastRowId = Number(rows.at(-1)?.__source_rowid);
			for (const row of rows) delete row.__source_rowid;
			yield rows;
		}
	}
	inspect() {
		const integrity = this.database.prepare("PRAGMA integrity_check").get();
		if (integrity?.integrity_check !== "ok")
			throw new Error("SQLITE_INTEGRITY_CHECK_FAILED");
		const tables = this.database
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
			)
			.all()
			.map((row) => String(row.name));
		if (tables.join() !== Object.keys(SOURCE_COLUMNS).sort().join())
			throw new Error("SQLITE_SOURCE_TABLES_UNSUPPORTED");
		const inventory = tables.map((table) => {
			const columns = this.database
				.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
				.all();
			if (
				columns
					.map((column) => column.name)
					.sort()
					.join() !== [...SOURCE_COLUMNS[table]].sort().join()
			)
				throw new Error(`SQLITE_SOURCE_COLUMNS_UNSUPPORTED:${table}`);
			return {
				table,
				columns: columns.map((column) => ({
					name: String(column.name),
					type: String(column.type),
				})),
				count: Number(
					this.database
						.prepare(`SELECT count(*) AS count FROM ${quoteIdentifier(table)}`)
						.get()?.count,
				),
			};
		});
		const upgrades = this.rows("__qingyan_upgrades");
		const latest = upgrades.at(-1);
		if (latest?.to_version !== "0.2.5")
			throw new Error("SQLITE_SOURCE_VERSION_UNSUPPORTED");
		const migrations = this.rows("__qingyan_migrations").map((row) => row.name);
		if (
			migrations.join() !==
			[
				"0000_initial.sql",
				"0001_notification_reliability.sql",
				"0002_site_notification_events.sql",
				"0003_comment_email_delivery_observability.sql",
			].join()
		)
			throw new Error("SQLITE_SOURCE_MIGRATIONS_UNSUPPORTED");
		return {
			version: "0.2.5",
			inventory,
			migrations,
			sequences: this.rows("sqlite_sequence").map((row) => ({
				table: String(row.name),
				highWater: Number(row.seq),
			})),
			schemaFingerprint: createHash("sha256")
				.update(
					JSON.stringify(
						inventory.map(({ table, columns }) => ({ table, columns })),
					),
				)
				.digest("hex"),
		};
	}
}

/** Backup API 固定读事务快照；WAL/SHM 仅归档用于诊断，不参与恢复。 */
export async function archiveSource(
	sourcePath: string,
	outputDirectory: string,
) {
	await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
	const snapshotPath = path.join(outputDirectory, "source.sqlite");
	const source = new SqliteSource(sourcePath);
	try {
		source.inspect();
		await backup(source.database, snapshotPath);
	} finally {
		source.close();
	}
	await chmod(snapshotPath, 0o600);
	for (const suffix of ["-wal", "-shm"]) {
		try {
			await copyFile(
				`${sourcePath}${suffix}`,
				path.join(outputDirectory, `diagnostic${suffix}`),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	const archive = new SqliteSource(snapshotPath);
	try {
		return {
			...archive.inspect(),
			snapshot: "source.sqlite",
			snapshotChecksum: await checksum(snapshotPath),
			snapshotBytes: (await stat(snapshotPath)).size,
			sourceFileChecksum: await checksum(sourcePath),
		};
	} finally {
		archive.close();
	}
}

export async function readProtectedJson<T>(filePath: string): Promise<T> {
	return JSON.parse(await readFile(filePath, "utf8")) as T;
}
