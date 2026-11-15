import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FullBackupService } from "../../src/modules/backup/full-backup-service";
import { createLifecycleFixture } from "../support/lifecycle-fixture";

describe("FullBackupService", () => {
	it("includes version, checksums and environment names while excluding environment secret values", async () => {
		const fixture = await createLifecycleFixture();
		try {
			await fixture.pool.query(
				"INSERT INTO system_settings(category,key,value_json) VALUES('ipRegion','enabled','true')",
			);
			const result = await new FullBackupService({
				configPath: fixture.configPath,
				config: fixture.config,
				pool: fixture.pool,
				packageVersion: "0.2.5",
				env: {
					QINGYAN_DATABASE_URL: fixture.databaseUrl,
					QINGYAN_SMTP_PASSWORD: "raw-secret",
					QINGYAN_PUBLIC_BASE_URL: "https://example.com",
				},
			}).createBackup({ outputPath: path.join(fixture.directory, "full") });
			expect(result.manifest).toMatchObject({
				format: "qingyan.full-backup",
				formatVersion: 1,
				qingyanVersion: "0.2.5",
				database: { client: "postgresql", backupStrategy: "pg_dump_custom" },
				config: { adminConsolePath: "/admin" },
			});
			expect(result.manifest.environment.detected).toContainEqual({
				name: "QINGYAN_DATABASE_URL",
				category: "startup",
				secret: true,
				included: false,
			});
			expect(JSON.stringify(result.manifest)).not.toContain("raw-secret");
			expect(JSON.stringify(result.manifest)).not.toContain(
				fixture.databaseUrl,
			);
			expect(
				existsSync(path.join(result.outputDirectory, "database/qingyan.dump")),
			).toBe(true);
			expect(
				readFileSync(path.join(result.outputDirectory, "database/qingyan.dump"))
					.subarray(0, 5)
					.toString(),
			).toBe("PGDMP");
		} finally {
			await fixture.cleanup();
		}
	});
});
