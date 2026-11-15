import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RestoreService } from "../../src/modules/backup/restore-service";
import { createUpgradeBackups } from "../../src/modules/upgrade/backup";
import { createLifecycleFixture } from "../support/lifecycle-fixture";

describe("upgrade backup", () => {
	it("restores its redacted upgrade package, database and resources into an empty target", async () => {
		const fixture = await createLifecycleFixture();
		const target = await createLifecycleFixture({ empty: true });
		try {
			const resource = path.join(fixture.directory, "active-v4.xdb");
			const resourceBytes = Buffer.from("backup-resource-bytes\0\u00ff");
			writeFileSync(resource, resourceBytes);
			const configuredV4 = path.join(fixture.directory, "configured-v4.xdb");
			const configuredV6 = path.join(fixture.directory, "configured-v6.xdb");
			const configuredV4Bytes = Buffer.from("manual-v4-resource\0");
			const configuredV6Bytes = Buffer.from("manual-v6-resource\0");
			writeFileSync(configuredV4, configuredV4Bytes);
			writeFileSync(configuredV6, configuredV6Bytes);
			await fixture.pool.query(
				"INSERT INTO ip_region_database_state(ip_version,file_path,file_hash,activated_at,updated_at) VALUES('v4',$1,'fixture-hash',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
				[resource],
			);
			await fixture.pool.query(
				"INSERT INTO system_settings(category,key,value_json) VALUES('ipRegion','ipv4.dbPath',$1),('ipRegion','ipv6.dbPath',$2)",
				[JSON.stringify(configuredV4), JSON.stringify(configuredV6)],
			);
			const backup = await createUpgradeBackups({
				configPath: fixture.configPath,
				database: fixture.config.database,
				backupDirectory: path.join(fixture.directory, "backup"),
				plan: {
					currentVersion: "0.2.4",
					targetVersion: "0.2.5",
					schemaMigrations: [],
					applicationUpgrades: [],
					configChanges: [
						{
							path: "database.url",
							action: "update",
							after: fixture.databaseUrl,
						},
					],
					dbSettingChanges: [],
					secretHandling: [],
					backupPaths: {},
					risks: [],
				},
			});
			const plan = backup.files.find((file) => file.role === "plan");
			expect(readFileSync(plan?.backupPath ?? "", "utf8")).not.toContain(
				fixture.databaseUrl,
			);
			expect(
				readFileSync(backup.databaseBackupPath).subarray(0, 5).toString(),
			).toBe("PGDMP");
			const manifest = readFileSync(backup.manifestPath, "utf8");
			expect(JSON.parse(manifest)).toMatchObject({
				format: "qingyan.full-backup",
				qingyanVersion: "0.2.4",
				upgrade: { fromVersion: "0.2.4", toVersion: "0.2.5" },
				success: true,
			});
			expect(manifest).not.toContain(fixture.databaseUrl);
			const restore = new RestoreService({
				currentVersion: "0.2.5",
				currentConfigPath: fixture.configPath,
			});
			expect(
				restore.plan({ backupPath: backup.backupDirectory }),
			).toMatchObject({ backupVersion: "0.2.4", upgradeRequired: true });
			mkdirSync(path.dirname(target.configPath), { recursive: true });
			const outputConfigPath = path.join(
				path.dirname(target.configPath),
				"restored.yml",
			);
			await restore.apply({
				backupPath: backup.backupDirectory,
				database: target.config.database,
				outputConfigPath,
				confirm: "RESTORE QINGYAN",
			});
			for (const query of [
				"SELECT site_key,name FROM sites",
				"SELECT username,password_hash FROM admin_users",
				"SELECT name,summary_json FROM __qingyan_upgrades",
			]) {
				expect((await target.pool.query(query)).rows).toEqual(
					(await fixture.pool.query(query)).rows,
				);
			}
			const restoredResource = (
				await target.pool.query(
					"SELECT file_path FROM ip_region_database_state WHERE ip_version='v4'",
				)
			).rows[0].file_path;
			expect(readFileSync(restoredResource)).toEqual(resourceBytes);
			for (const [key, expectedBytes] of [
				["ipv4.dbPath", configuredV4Bytes],
				["ipv6.dbPath", configuredV6Bytes],
			] as const) {
				const setting = await target.pool.query(
					"SELECT value_json FROM system_settings WHERE category='ipRegion' AND key=$1",
					[key],
				);
				const restoredPath = JSON.parse(setting.rows[0].value_json);
				expect(restoredPath).not.toBe(restoredResource);
				expect(readFileSync(restoredPath)).toEqual(expectedBytes);
			}
			expect(readFileSync(outputConfigPath, "utf8")).toContain(
				target.databaseUrl,
			);
		} finally {
			await target.cleanup();
			await fixture.cleanup();
		}
	});
});
