import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import { createDatabaseClients } from "../../db/client";
import {
	applyDatabaseMigrations,
	DEFAULT_MIGRATION_DIRECTORY,
	getDatabaseMigrationState,
} from "../../db/migrations";
import {
	applyPreparedConfiguration,
	prepareConfiguration,
	readLegacyConfig,
	type ConfigPreparation,
} from "./config";
import { fieldManifest, IMPORT_ORDER, targetColumns } from "./model";
import {
	archiveSource,
	checksum,
	quoteIdentifier,
	readProtectedJson,
	type SourceRow,
	SqliteSource,
	writeProtectedJson,
} from "./source";
import {
	createContext,
	ipDatabaseStates,
	metadataFallback,
	type RowMapping,
	transformRow,
} from "./transform";
import { verifyConvertedDatabase } from "./verify";

export interface ConversionOptions {
	sourcePath: string;
	databaseUrl: string;
	outputDirectory: string;
	sourceConfigPath?: string;
	sourceRoot?: string;
	sourceRuntimeRoot?: string;
	sourceStopped: boolean;
	targetVersion?: string;
	migrationDirectory?: string;
	onProgress?: (table: string, count: number) => void;
}

async function assertEmptyTarget(pool: Pool) {
	const objects = await pool.query(
		"SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','S','v','m','f')",
	);
	if (objects.rowCount) throw new Error("CONVERSION_TARGET_NOT_EMPTY");
	const version = await pool.query("SHOW server_version_num");
	if (Number(version.rows[0].server_version_num) < 180000)
		throw new Error("POSTGRESQL_18_REQUIRED");
}

async function insertPage(
	client: PoolClient,
	table: string,
	rows: SourceRow[],
) {
	if (rows.length === 0) return;
	const columns = targetColumns(table).map((column) => column.name);
	const values = rows.flatMap((row) => columns.map((column) => row[column]));
	const placeholders = rows
		.map(
			(_, rowIndex) =>
				`(${columns.map((__, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(",")})`,
		)
		.join(",");
	let conflict = "";
	if (table === "task_metric_rollups")
		conflict = ` ON CONFLICT (id) DO UPDATE SET value = task_metric_rollups.value + EXCLUDED.value, sample_count = task_metric_rollups.sample_count + EXCLUDED.sample_count, created_at = LEAST(task_metric_rollups.created_at, EXCLUDED.created_at), updated_at = GREATEST(task_metric_rollups.updated_at, EXCLUDED.updated_at)`;
	if (table === "visitor_request_metadata") {
		const assignments = columns
			.filter((column) => column !== "id")
			.map((column) => {
				const name = quoteIdentifier(column);
				if (column === "seen_count")
					return `${name} = visitor_request_metadata.${name} + EXCLUDED.${name}`;
				if (["created_at", "first_seen_at"].includes(column))
					return `${name} = LEAST(visitor_request_metadata.${name}, EXCLUDED.${name})`;
				if (["updated_at", "last_seen_at"].includes(column))
					return `${name} = GREATEST(visitor_request_metadata.${name}, EXCLUDED.${name})`;
				return `${name} = CASE WHEN EXCLUDED.last_seen_at >= visitor_request_metadata.last_seen_at THEN EXCLUDED.${name} ELSE visitor_request_metadata.${name} END`;
			});
		conflict = ` ON CONFLICT (id) DO UPDATE SET ${assignments.join(",")}`;
	}
	// 同一 INSERT 不能重复更新同一行；合并目标相同时拆成稳定的小批次。
	if (conflict && new Set(rows.map((row) => row.id)).size !== rows.length) {
		for (const row of rows) await insertPage(client, table, [row]);
		return;
	}
	await client.query(
		`INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(",")}) VALUES ${placeholders}${conflict}`,
		values,
	);
}

function* boundedBatches(rows: SourceRow[]): Generator<SourceRow[]> {
	let batch: SourceRow[] = [];
	let bytes = 0;
	for (const row of rows) {
		const rowBytes = Object.values(row).reduce<number>(
			(total, value) =>
				total +
				(typeof value === "string"
					? Buffer.byteLength(value)
					: value instanceof Uint8Array
						? value.byteLength
						: 8),
			0,
		);
		if (
			batch.length &&
			(bytes + rowBytes > 2 * 1024 * 1024 || batch.length >= 250)
		) {
			yield batch;
			batch = [];
			bytes = 0;
		}
		batch.push(row);
		bytes += rowBytes;
	}
	if (batch.length) yield batch;
}

async function restoreSequences(pool: Pool, source: SqliteSource) {
	const sourceSequences = new Map(
		source.inspect().sequences.map((entry) => [entry.table, entry.highWater]),
	);
	const sequences = await pool.query<{
		table_name: string;
		column_name: string;
	}>(
		"SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND is_identity='YES' ORDER BY table_name,column_name",
	);
	const report = [];
	for (const sequence of sequences.rows) {
		const maximum = Number(
			(
				await pool.query(
					`SELECT coalesce(max(${quoteIdentifier(sequence.column_name)}),0) AS maximum FROM ${quoteIdentifier(sequence.table_name)}`,
				)
			).rows[0].maximum,
		);
		const highWater = Math.max(
			maximum,
			sourceSequences.get(sequence.table_name) ?? 0,
		);
		await pool.query("SELECT setval(pg_get_serial_sequence($1,$2),$3,$4)", [
			sequence.table_name,
			sequence.column_name,
			Math.max(1, highWater),
			highWater > 0,
		]);
		const state = await pool.query<{ sequence_name: string }>(
			"SELECT pg_get_serial_sequence($1,$2) AS sequence_name",
			[sequence.table_name, sequence.column_name],
		);
		const actual = (
			await pool.query(
				`SELECT last_value,is_called FROM ${state.rows[0].sequence_name.split(".").map(quoteIdentifier).join(".")}`,
			)
		).rows[0];
		const nextValue = Number(actual.last_value) + (actual.is_called ? 1 : 0);
		if (nextValue <= highWater)
			throw new Error("CONVERSION_SEQUENCE_HIGH_WATER_INVALID");
		report.push({
			table: sequence.table_name,
			sourceHighWater: sourceSequences.get(sequence.table_name) ?? 0,
			maximum,
			nextValue,
		});
	}
	return report;
}

export async function analyzeSqliteSource(
	sourcePath: string,
	outputDirectory: string,
) {
	await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
	const source = new SqliteSource(sourcePath);
	try {
		const analysis = {
			...source.inspect(),
			sourceChecksum: await checksum(sourcePath),
			sourceBytes: (await stat(sourcePath)).size,
			fields: fieldManifest(),
		};
		await writeProtectedJson(
			path.join(outputDirectory, "analysis.json"),
			analysis,
		);
		return {
			sourceVersion: analysis.version,
			sourceTables: analysis.inventory.length,
			sourceRows: analysis.inventory.reduce(
				(total, table) => total + table.count,
				0,
			),
			sourceChecksum: analysis.sourceChecksum,
		};
	} finally {
		source.close();
	}
}

export async function convertSqliteDatabase(options: ConversionOptions) {
	if (!options.sourceStopped)
		throw new Error("SOURCE_STOPPED_CONFIRMATION_REQUIRED");
	const startedAt = performance.now();
	const conversionId = randomUUID();
	const targetVersion =
		options.targetVersion ??
		(
			JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as {
				version: string;
			}
		).version;
	try {
		await stat(path.join(options.outputDirectory, "source.sqlite"));
		throw new Error("CONVERSION_OUTPUT_ALREADY_USED");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const clients = createDatabaseClients(options.databaseUrl, {
		pool: { max: 2 },
	});
	let source: SqliteSource | undefined;
	try {
		await assertEmptyTarget(clients.pool);
		const archive = await archiveSource(
			options.sourcePath,
			options.outputDirectory,
		);
		source = new SqliteSource(
			path.join(options.outputDirectory, "source.sqlite"),
		);
		const legacy = options.sourceConfigPath
			? await readLegacyConfig(options.sourceConfigPath)
			: undefined;
		if (legacy)
			await writeFile(
				path.join(options.outputDirectory, "source-config.yml"),
				legacy.text,
				{ mode: 0o600 },
			);
		const context = createContext(source, legacy?.overrides);
		const databaseIdentity = (
			await clients.pool.query(
				"SELECT current_database() AS database,current_user AS role,inet_server_addr()::text AS host,inet_server_port() AS port",
			)
		).rows[0];
		const marker = {
			conversionId,
			state: "started",
			sourceChecksum: archive.snapshotChecksum,
			targetVersion,
			databaseIdentity,
		};
		await writeProtectedJson(
			path.join(options.outputDirectory, "conversion-marker.json"),
			marker,
		);
		await writeProtectedJson(
			path.join(options.outputDirectory, "conversion.json"),
			{ ...marker, archive, fields: fieldManifest() },
		);
		await applyDatabaseMigrations(
			clients.pool,
			options.migrationDirectory ?? DEFAULT_MIGRATION_DIRECTORY,
			{
				afterMigrate: async (client) => {
					await client.query(
						"INSERT INTO __qingyan_upgrades (name,from_version,to_version,summary_json) VALUES ('sqlite-to-postgresql-started',$1,$2,$3)",
						[
							"0.2.5",
							targetVersion,
							JSON.stringify({
								conversionId,
								sourceFingerprint: archive.snapshotChecksum,
								targetVersion,
								databaseIdentity,
							}),
						],
					);
				},
			},
		);
		const importStartedAt = performance.now();
		for (const table of IMPORT_ORDER) {
			let count = 0;
			const pages =
				table === "comment_request_metadata"
					? [metadataFallback(context)]
					: table === "ip_region_database_state"
						? [ipDatabaseStates(context)]
						: source.pages(table);
			for (const sourcePage of pages) {
				const transformed =
					table === "comment_request_metadata"
						? sourcePage
						: sourcePage
								.map((row) => transformRow(table, row, context))
								.filter((row): row is SourceRow => row !== null);
				for (const rows of boundedBatches(transformed)) {
					const client = await clients.pool.connect();
					try {
						await client.query("BEGIN");
						await insertPage(
							client,
							table,
							table === "comments"
								? rows.map((row) => ({ ...row, parent_id: null }))
								: rows,
						);
						await client.query("COMMIT");
					} catch (error) {
						await client.query("ROLLBACK");
						throw error;
					} finally {
						client.release();
					}
					count += rows.length;
				}
			}
			if (table === "comments") {
				for (const page of source.pages("comments")) {
					const children = page.filter((row) => row.parent_id !== null);
					if (!children.length) continue;
					const parameters = children.flatMap((row) => [row.id, row.parent_id]);
					const placeholders = children
						.map(
							(_, index) => `($${index * 2 + 1}::text,$${index * 2 + 2}::text)`,
						)
						.join(",");
					await clients.pool.query(
						`UPDATE comments AS c SET parent_id=p.parent_id FROM (VALUES ${placeholders}) AS p(id,parent_id) WHERE c.id=p.id`,
						parameters,
					);
				}
			}
			options.onProgress?.(table, count);
		}
		const importElapsedMs = Math.round(performance.now() - importStartedAt);
		const sequences = await restoreSequences(clients.pool, source);
		const structure = await getDatabaseMigrationState(
			clients.pool,
			options.migrationDirectory ?? DEFAULT_MIGRATION_DIRECTORY,
		);
		if (
			structure.pending.length ||
			structure.unknown.length ||
			structure.checksumMismatches.length
		)
			throw new Error("TARGET_SCHEMA_VERIFICATION_FAILED");
		const verification = await verifyConvertedDatabase(
			clients.pool,
			source,
			context,
		);
		await clients.pool.query("ANALYZE");
		const queryPlans = await Promise.all([
			clients.pool.query(
				"EXPLAIN (FORMAT JSON) SELECT id FROM comments WHERE page_thread_id = (SELECT min(id) FROM page_threads) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20",
			),
			clients.pool.query(
				"EXPLAIN (FORMAT JSON) SELECT * FROM task_metric_rollups WHERE metric_key='api_requests' AND bucket_start_at >= CURRENT_TIMESTAMP - INTERVAL '1 day'",
			),
		]);
		let configuration: ConfigPreparation | null = null;
		if (options.sourceConfigPath)
			configuration = await prepareConfiguration({
				configPath: path.join(options.outputDirectory, "source-config.yml"),
				sourceRoot: options.sourceRoot,
				sourceRuntimeRoot: options.sourceRuntimeRoot,
				databaseUrl: options.databaseUrl,
				outputDirectory: options.outputDirectory,
				source,
			});
		if (
			(await checksum(path.join(options.outputDirectory, "source.sqlite"))) !==
			archive.snapshotChecksum
		)
			throw new Error("SOURCE_SNAPSHOT_CHANGED");
		const report = {
			conversionId,
			targetVersion,
			state: "database_completed",
			archive,
			databaseIdentity,
			fields: fieldManifest(),
			rowMappings: context.rowMappings,
			differences: context.differences,
			sequences,
			verification,
			configuration,
			retention: {
				importedHistory:
					"all preserved; converter authorizes no initial automatic cleanup of imported history",
				retiredBackup: "complete source.sqlite archive",
			},
			queryPlans: queryPlans.map((result) => result.rows),
			importElapsedMs,
			elapsedMs: Math.round(performance.now() - startedAt),
			peakRssBytes: process.resourceUsage().maxRSS * 1024,
			targetBytes: Number(
				(
					await clients.pool.query(
						"SELECT pg_database_size(current_database()) AS bytes",
					)
				).rows[0].bytes,
			),
		};
		await writeProtectedJson(
			path.join(options.outputDirectory, "conversion.json"),
			report,
		);
		const reportChecksum = await checksum(
			path.join(options.outputDirectory, "conversion.json"),
		);
		await clients.pool.query(
			"INSERT INTO __qingyan_upgrades (name,from_version,to_version,summary_json) VALUES ('sqlite-to-postgresql-completed',$1,$2,$3)",
			[
				"0.2.5",
				targetVersion,
				JSON.stringify({
					conversionId,
					sourceFingerprint: archive.snapshotChecksum,
					targetVersion,
					reportChecksum,
					verified: true,
					convertedAt: new Date().toISOString(),
					importedHistoryCleanupBefore: null,
				}),
			],
		);
		await writeProtectedJson(
			path.join(options.outputDirectory, "conversion-marker.json"),
			{
				...marker,
				state: "database_completed",
				configurationSwitchPending: true,
				reportChecksum,
			},
		);
		return report;
	} catch (error) {
		await writeProtectedJson(
			path.join(options.outputDirectory, "failure.json"),
			{
				conversionId,
				failed: true,
				recovery:
					"Preserve this target. Retry from the same frozen snapshot into a new empty database.",
				code: safeConversionError(error),
			},
		).catch(() => {});
		throw error;
	} finally {
		source?.close();
		await clients.close();
	}
}

export async function verifyConversionArtifact(
	databaseUrl: string,
	outputDirectory: string,
) {
	const report = await readProtectedJson<{
		conversionId: string;
		archive: { snapshotChecksum: string };
		rowMappings: RowMapping[];
		configuration: ConfigPreparation | null;
	}>(path.join(outputDirectory, "conversion.json"));
	if (
		(await checksum(path.join(outputDirectory, "source.sqlite"))) !==
		report.archive.snapshotChecksum
	)
		throw new Error("SOURCE_ARCHIVE_CHECKSUM_MISMATCH");
	const source = new SqliteSource(path.join(outputDirectory, "source.sqlite"));
	const clients = createDatabaseClients(databaseUrl);
	try {
		const legacy = await readLegacyConfig(
			path.join(outputDirectory, "source-config.yml"),
		).catch((error) => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		});
		const context = createContext(source, legacy?.overrides);
		context.rowMappings = report.rowMappings;
		const ledger = (
			await clients.pool.query(
				"SELECT name,summary_json FROM __qingyan_upgrades WHERE name IN ('sqlite-to-postgresql-started','sqlite-to-postgresql-completed')",
			)
		).rows;
		if (
			ledger.length !== 2 ||
			ledger.some(
				(row) =>
					JSON.parse(row.summary_json).conversionId !== report.conversionId,
			)
		)
			throw new Error("CONVERSION_LEDGER_INCOMPLETE");
		const completed = ledger.find(
			(row) => row.name === "sqlite-to-postgresql-completed",
		);
		if (
			JSON.parse(completed.summary_json).reportChecksum !==
			(await checksum(path.join(outputDirectory, "conversion.json")))
		)
			throw new Error("CONVERSION_REPORT_CHECKSUM_MISMATCH");
		if (report.configuration) {
			const configuration = await readProtectedJson<ConfigPreparation>(
				path.join(outputDirectory, "configuration.json"),
			);
			if (!isDeepStrictEqual(configuration, report.configuration))
				throw new Error("CONVERSION_CONFIGURATION_MANIFEST_CHANGED");
			if (
				(await checksum(path.join(outputDirectory, "source-config.yml"))) !==
				configuration.sourceConfigChecksum
			)
				throw new Error("SOURCE_CONFIG_ARCHIVE_CHANGED");
			if (
				(await checksum(path.join(outputDirectory, "target-config.yml"))) !==
				configuration.generatedConfigChecksum
			)
				throw new Error("PREPARED_CONFIG_CHANGED");
			for (const resource of configuration.resources) {
				if (
					resource.available &&
					(!resource.archive ||
						(await checksum(path.join(outputDirectory, resource.archive))) !==
							resource.checksum)
				)
					throw new Error("SOURCE_RESOURCE_ARCHIVE_CHANGED");
			}
		}
		const migrationState = await getDatabaseMigrationState(clients.pool);
		if (
			migrationState.pending.length ||
			migrationState.unknown.length ||
			migrationState.checksumMismatches.length
		)
			throw new Error("TARGET_SCHEMA_VERIFICATION_FAILED");
		return await verifyConvertedDatabase(clients.pool, source, context);
	} finally {
		source.close();
		await clients.close();
	}
}

export async function switchConversionConfiguration(
	databaseUrl: string,
	outputDirectory: string,
	destination: string,
	expectedDestinationChecksum: string,
) {
	await verifyConversionArtifact(databaseUrl, outputDirectory);
	const result = await applyPreparedConfiguration({
		outputDirectory,
		destination,
		expectedDestinationChecksum,
	});
	await writeProtectedJson(
		path.join(outputDirectory, "conversion-marker.json"),
		{
			state: "completed",
			configurationSwitchPending: false,
			appliedAt: new Date().toISOString(),
		},
	);
	return result;
}

export function safeConversionError(error: unknown): string {
	const message = error instanceof Error ? error.message : "CONVERSION_FAILED";
	return /^[A-Z][A-Z0-9_:.-]+$/.test(message)
		? message
		: `CONVERSION_FAILED${typeof error === "object" && error !== null && "code" in error && /^[A-Z0-9]+$/.test(String(error.code)) ? `:${error.code}` : ""}`;
}
