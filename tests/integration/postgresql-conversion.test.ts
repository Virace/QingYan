import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load-config";
import { createDatabaseClients } from "../../src/db/client";
import { applyPreparedConfiguration } from "../../src/modules/database-conversion/config";
import {
	convertSqliteDatabase,
	verifyConversionArtifact,
} from "../../src/modules/database-conversion/service";
import {
	checksum,
	SqliteSource,
	writeProtectedJson,
} from "../../src/modules/database-conversion/source";
import { detectUpgradeRuntimeState } from "../../src/modules/upgrade/state";

const sourcePath = process.env.QINGYAN_CONVERSION_SOURCE_SQLITE;
const configPath = process.env.QINGYAN_CONVERSION_SOURCE_CONFIG;
const serverUrl = process.env.QINGYAN_TEST_DATABASE_URL;
const root = path.resolve(".temp/postgresql-migration/conversion/tests");

async function emptyDatabase() {
	const databaseName = `qingyan_conversion_test_${randomUUID().replaceAll("-", "")}`;
	const admin = new Pool({ connectionString: serverUrl, max: 1 });
	try {
		await admin.query(`CREATE DATABASE "${databaseName}"`);
	} finally {
		await admin.end();
	}
	const databaseUrl = new URL(serverUrl as string);
	databaseUrl.pathname = `/${databaseName}`;
	return {
		databaseUrl: databaseUrl.toString(),
		outputDirectory: path.join(root, databaseName),
	};
}

describe("SQLite offline conversion gates", () => {
	it("requires an explicit stopped-source handoff before opening either database", async () => {
		await expect(
			convertSqliteDatabase({
				sourcePath: "not-opened.sqlite",
				databaseUrl: "postgresql://invalid/unused",
				outputDirectory: root,
				sourceStopped: false,
			}),
		).rejects.toThrow("SOURCE_STOPPED_CONFIRMATION_REQUIRED");
	});

	it("rejects a changed destination config before writing its backup or replacement", async () => {
		const directory = path.join(root, `config-${randomUUID()}`);
		await mkdir(directory, { recursive: true });
		const destination = path.join(directory, "existing.yml");
		await writeFile(destination, "preserve: true\n");
		await writeProtectedJson(path.join(directory, "configuration.json"), {
			readyForConfigSwitch: true,
		});
		await expect(
			applyPreparedConfiguration({
				outputDirectory: directory,
				destination,
				expectedDestinationChecksum: "0".repeat(64),
			}),
		).rejects.toThrow("CONFIG_DESTINATION_CHANGED");
		expect(await readFile(destination, "utf8")).toBe("preserve: true\n");
	});

	it("resumes the file step when configuration replacement finished before marker completion", async () => {
		const directory = path.join(root, `config-resume-${randomUUID()}`);
		await mkdir(directory, { recursive: true });
		const destination = path.join(directory, "existing.yml");
		const targetPath = path.join(directory, "target-config.yml");
		await writeFile(destination, "database: old\n");
		const originalChecksum = await checksum(destination);
		await writeFile(targetPath, "database: new\n");
		await writeProtectedJson(path.join(directory, "configuration.json"), {
			readyForConfigSwitch: true,
			generatedConfigChecksum: await checksum(targetPath),
		});
		const options = {
			outputDirectory: directory,
			destination,
			expectedDestinationChecksum: originalChecksum,
		};
		await applyPreparedConfiguration(options);
		await applyPreparedConfiguration(options);
		expect(await readFile(destination, "utf8")).toBe("database: new\n");
		expect(
			await readFile(path.join(directory, "previous-config.yml"), "utf8"),
		).toBe("database: old\n");
	});

	it.skipIf(!serverUrl)(
		"refuses a nonempty PostgreSQL target without touching existing objects",
		async () => {
			const workspace = await emptyDatabase();
			const clients = createDatabaseClients(workspace.databaseUrl);
			try {
				await clients.pool.query(
					"CREATE TABLE conversion_existing_marker (value integer)",
				);
				await clients.pool.query(
					"INSERT INTO conversion_existing_marker VALUES (17)",
				);
				await expect(
					convertSqliteDatabase({
						...workspace,
						sourcePath: "not-opened.sqlite",
						sourceStopped: true,
					}),
				).rejects.toThrow("CONVERSION_TARGET_NOT_EMPTY");
				expect(
					(
						await clients.pool.query(
							"SELECT value FROM conversion_existing_marker",
						)
					).rows,
				).toEqual([{ value: 17 }]);
			} finally {
				await clients.close();
			}
		},
	);
});

describe.skipIf(!sourcePath || !configPath || !serverUrl)(
	"real 0.2.5 source conversion",
	() => {
		it("retains started state after interruption, blocks normal startup, and preserves the source", async () => {
			const workspace = await emptyDatabase();
			const originalChecksum = await checksum(sourcePath as string);
			await expect(
				convertSqliteDatabase({
					...workspace,
					sourcePath: sourcePath as string,
					sourceConfigPath: configPath,
					sourceStopped: true,
					onProgress() {
						throw new Error("CONTROLLED_INTERRUPTION");
					},
				}),
			).rejects.toThrow("CONTROLLED_INTERRUPTION");
			const clients = createDatabaseClients(workspace.databaseUrl);
			try {
				const records = (
					await clients.pool.query(
						"SELECT name FROM __qingyan_upgrades ORDER BY name",
					)
				).rows;
				expect(records).toEqual([{ name: "sqlite-to-postgresql-started" }]);
			} finally {
				await clients.close();
			}
			const legacy = await readFile(configPath as string, "utf8");
			const targetConfig = path.join(workspace.outputDirectory, "probe.yml");
			const { parse, stringify } = await import("yaml");
			const parsed = parse(legacy);
			parsed.database = { url: workspace.databaseUrl };
			await writeFile(targetConfig, stringify(parsed), { mode: 0o600 });
			const runtime = await detectUpgradeRuntimeState({
				configPath: targetConfig,
				loadedConfig: await loadConfig(targetConfig, {}),
				currentApplicationVersion: "0.2.5",
			});
			expect(runtime.state).toBe("recovery_required");
			expect(await checksum(sourcePath as string)).toBe(originalChecksum);
		}, 90_000);

		it("converts and independently reopens every active source field and all archive tables", async () => {
			const workspace = await emptyDatabase();
			const originalChecksum = await checksum(sourcePath as string);
			const report = await convertSqliteDatabase({
				...workspace,
				sourcePath: sourcePath as string,
				sourceConfigPath: configPath,
				sourceStopped: true,
			});
			expect(report.verification.verified).toBe(true);
			expect(report.verification.tables).toHaveLength(43);
			const reopened = await verifyConversionArtifact(
				workspace.databaseUrl,
				workspace.outputDirectory,
			);
			expect(reopened.verified).toBe(true);
			const original = new SqliteSource(sourcePath as string);
			const archived = new SqliteSource(
				path.join(workspace.outputDirectory, "source.sqlite"),
			);
			const clients = createDatabaseClients(workspace.databaseUrl);
			try {
				for (const table of [
					"admin_group_permissions",
					"site_notification_recipients",
					"site_notification_recipient_routes",
					"ip_region_update_runs",
					"import_batches",
					"import_records",
				]) {
					expect(archived.rows(table)).toEqual(original.rows(table));
				}
				const sourceTokens = original
					.rows("unsubscribe_tokens")
					.map((row) => [row.id, row.token_hash, row.consumed_at]);
				const targetTokens = (
					await clients.pool.query(
						"SELECT id,token_hash,consumed_at FROM unsubscribe_tokens ORDER BY created_at,id",
					)
				).rows.map((row) => [row.id, row.token_hash, row.consumed_at]);
				expect(new Set(targetTokens.map((row) => JSON.stringify(row)))).toEqual(
					new Set(sourceTokens.map((row) => JSON.stringify(row))),
				);
				const ledgers = (
					await clients.pool.query(
						"SELECT summary_json FROM __qingyan_upgrades WHERE name IN ('sqlite-to-postgresql-started','sqlite-to-postgresql-completed')",
					)
				).rows.map((row) => JSON.parse(row.summary_json).conversionId);
				expect(ledgers).toEqual([report.conversionId, report.conversionId]);
				const runtime = await detectUpgradeRuntimeState({
					configPath: path.join(workspace.outputDirectory, "target-config.yml"),
					loadedConfig: await loadConfig(
						path.join(workspace.outputDirectory, "target-config.yml"),
						{},
					),
					currentApplicationVersion: report.targetVersion,
				});
				expect(runtime.state).toBe("normal_current");
				const configurationPath = path.join(
					workspace.outputDirectory,
					"configuration.json",
				);
				const configurationText = await readFile(configurationPath, "utf8");
				const changedConfiguration = JSON.parse(configurationText);
				changedConfiguration.readyForConfigSwitch =
					!changedConfiguration.readyForConfigSwitch;
				await writeProtectedJson(configurationPath, changedConfiguration);
				await expect(
					verifyConversionArtifact(
						workspace.databaseUrl,
						workspace.outputDirectory,
					),
				).rejects.toThrow("CONVERSION_CONFIGURATION_MANIFEST_CHANGED");
				await writeFile(configurationPath, configurationText, { mode: 0o600 });
			} finally {
				original.close();
				archived.close();
				await clients.close();
			}
			expect(await checksum(sourcePath as string)).toBe(originalChecksum);
		}, 180_000);
	},
);
