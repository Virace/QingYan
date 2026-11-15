import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DatabaseBackupService } from "../../src/modules/database-backup/database-backup-service";
import { createLifecycleFixture } from "../support/lifecycle-fixture";

describe("PostgreSQL database backup", () => {
	it("packages a custom dump, protected startup config, public plan and success metadata", async () => {
		const fixture = await createLifecycleFixture();
		try {
			const result = await new DatabaseBackupService({
				database: fixture.config.database,
				now: () => new Date("2026-05-07T00:00:00Z"),
			}).createUpgradeBackup({
				upgradeId: "upgrade-fixture",
				fromVersion: "0.2.4",
				toVersion: "0.2.5",
				configPath: fixture.configPath,
				plan: { targetVersion: "0.2.5" },
				partialMarkerPath: fixture.markerPath,
				backupDirectory: path.join(fixture.directory, "upgrade-backup"),
			});
			expect(result).toMatchObject({
				engine: "postgresql",
				strategy: "pg_dump_custom",
				kind: "upgrade_database_backup",
			});
			expect(
				readFileSync(result.databaseBackupPath).subarray(0, 5).toString(),
			).toBe("PGDMP");
			expect(result.files.map((file) => file.role)).toEqual(
				expect.arrayContaining(["database", "config", "plan"]),
			);
			expect(
				existsSync(path.join(result.backupDirectory, "metadata.json")),
			).toBe(true);
			const metadata = readFileSync(
				path.join(result.backupDirectory, "metadata.json"),
				"utf8",
			);
			expect(JSON.parse(metadata)).toMatchObject({ success: true });
			expect(metadata).not.toContain(fixture.databaseUrl);
		} finally {
			await fixture.cleanup();
		}
	});
});
