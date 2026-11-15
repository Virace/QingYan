import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabaseClients } from "../../src/db/client";
import {
	applyDatabaseMigrations,
	getDatabaseMigrationState,
} from "../../src/db/migrations";
import {
	createTestWorkspace,
	ensureTestDatabase,
} from "../support/test-fixtures";

describe("PostgreSQL structure migrations", () => {
	it("serializes concurrent baseline execution and records one committed migration", async () => {
		const workspace = createTestWorkspace("schema-migration-");
		await ensureTestDatabase(workspace.databaseUrl);
		const clients = createDatabaseClients(workspace.databaseUrl, {
			pool: { max: 2 },
		});
		try {
			await Promise.all([
				applyDatabaseMigrations(clients.pool),
				applyDatabaseMigrations(clients.pool),
			]);
			const state = await getDatabaseMigrationState(clients.pool);
			expect(state).toEqual({
				applied: ["0000_initial.sql", "0001_api_abuse_and_email_policy.sql"],
				pending: [],
				unknown: [],
				checksumMismatches: [],
			});
			const columns = await clients.pool.query<{
				table_name: string;
				column_name: string;
				data_type: string;
			}>(
				"SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND (table_name, column_name) IN (('comments','created_at'),('task_runs','claim_token'),('task_metric_rollups','value'),('task_metric_rollups','dimension_json'),('visitors','id'))",
			);
			expect(columns.rows).toEqual(
				expect.arrayContaining([
					{
						table_name: "comments",
						column_name: "created_at",
						data_type: "timestamp with time zone",
					},
					{
						table_name: "task_runs",
						column_name: "claim_token",
						data_type: "uuid",
					},
					{
						table_name: "task_metric_rollups",
						column_name: "value",
						data_type: "double precision",
					},
					{
						table_name: "task_metric_rollups",
						column_name: "dimension_json",
						data_type: "jsonb",
					},
					{ table_name: "visitors", column_name: "id", data_type: "bigint" },
				]),
			);
			const retired = await clients.pool.query(
				"SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])",
				[
					[
						"import_batches",
						"import_records",
						"admin_group_permissions",
						"site_notification_recipients",
						"site_notification_recipient_routes",
						"ip_region_update_runs",
					],
				],
			);
			expect(retired.rows).toEqual([]);
		} finally {
			await clients.close();
			await workspace.cleanup();
		}
	});

	it("upgrades the published baseline without losing site data and expires old captcha sessions", async () => {
		const workspace = createTestWorkspace("schema-abuse-upgrade-");
		await ensureTestDatabase(workspace.databaseUrl);
		const clients = createDatabaseClients(workspace.databaseUrl);
		const directory = path.join(workspace.directory, "baseline");
		mkdirSync(directory);
		copyFileSync(
			path.resolve("drizzle/postgresql/0000_initial.sql"),
			path.join(directory, "0000_initial.sql"),
		);
		try {
			await applyDatabaseMigrations(clients.pool, directory);
			const site = await clients.pool.query<{ id: string }>(
				"INSERT INTO sites(site_key,name,allowed_origins_json) VALUES('existing','Existing site','[]') RETURNING id",
			);
			const siteId = site.rows[0].id;
			const visitor = await clients.pool.query<{ id: string }>(
				"INSERT INTO visitors(site_id,visitor_key) VALUES($1,'existing-visitor') RETURNING id",
				[siteId],
			);
			await clients.pool.query(
				"INSERT INTO captcha_sessions(id,site_id,visitor_id,triggered_by,mode,verified,expires_at) VALUES('old-grant',$1,$2,'threshold','threshold',true,CURRENT_TIMESTAMP + INTERVAL '5 minutes')",
				[siteId, visitor.rows[0].id],
			);
			expect((await getDatabaseMigrationState(clients.pool)).pending).toEqual([
				"0001_api_abuse_and_email_policy.sql",
			]);
			await applyDatabaseMigrations(clients.pool);
			await applyDatabaseMigrations(clients.pool);
			expect(await getDatabaseMigrationState(clients.pool)).toEqual({
				applied: ["0000_initial.sql", "0001_api_abuse_and_email_policy.sql"],
				pending: [],
				unknown: [],
				checksumMismatches: [],
			});
			expect(
				(await clients.pool.query("SELECT site_key,name FROM sites")).rows,
			).toEqual([{ site_key: "existing", name: "Existing site" }]);
			expect(
				(await clients.pool.query("SELECT visitor_key FROM visitors")).rows,
			).toEqual([{ visitor_key: "existing-visitor" }]);
			expect(
				(await clients.pool.query("SELECT id FROM captcha_sessions")).rows,
			).toEqual([]);
		} finally {
			await clients.close();
			await workspace.cleanup();
		}
	});

	it("rolls back the baseline and conversion marker when the same transaction fails", async () => {
		const workspace = createTestWorkspace("schema-rollback-");
		await ensureTestDatabase(workspace.databaseUrl);
		const clients = createDatabaseClients(workspace.databaseUrl);
		try {
			await expect(
				applyDatabaseMigrations(clients.pool, undefined, {
					afterMigrate: async (client) => {
						await client.query(
							"INSERT INTO __qingyan_upgrades(name,to_version,summary_json) VALUES ('sqlite-to-postgresql-started','0.2.5','{}')",
						);
						await client.query("SELECT 1 / 0");
					},
				}),
			).rejects.toMatchObject({ code: "22012" });
			const tables = await clients.pool.query(
				"SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
			);
			expect(tables.rows).toEqual([]);
			await applyDatabaseMigrations(clients.pool);
			expect((await getDatabaseMigrationState(clients.pool)).pending).toEqual(
				[],
			);
		} finally {
			await clients.close();
			await workspace.cleanup();
		}
	});

	it("rejects an altered committed migration without applying more DDL", async () => {
		const workspace = createTestWorkspace("schema-checksum-");
		await ensureTestDatabase(workspace.databaseUrl);
		const clients = createDatabaseClients(workspace.databaseUrl);
		const directory = path.join(workspace.directory, "migrations");
		mkdirSync(directory);
		const migration = path.join(directory, "0000_probe.sql");
		writeFileSync(
			migration,
			"CREATE TABLE committed_probe(id integer PRIMARY KEY);",
		);
		try {
			await applyDatabaseMigrations(clients.pool, directory);
			writeFileSync(
				migration,
				"CREATE TABLE unauthorized_change(id integer PRIMARY KEY);",
			);
			await expect(
				applyDatabaseMigrations(clients.pool, directory),
			).rejects.toThrow("DATABASE_MIGRATION_CHECKSUM_MISMATCH");
			const tables = await clients.pool.query(
				"SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
			);
			expect(tables.rows.map((row) => row.tablename)).toEqual([
				"__qingyan_migrations",
				"committed_probe",
			]);
		} finally {
			await clients.close();
			await workspace.cleanup();
		}
	});
});
