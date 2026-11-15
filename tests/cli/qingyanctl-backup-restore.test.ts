import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/main";
import { FullBackupService } from "../../src/modules/backup/full-backup-service";
import { RestoreService } from "../../src/modules/backup/restore-service";
import { SystemdServiceController } from "../../src/modules/service-control/systemd-service";
import { createLifecycleFixture } from "../support/lifecycle-fixture";

class FakeService extends SystemdServiceController {
	calls: string[] = [];
	override async status() {
		this.calls.push("status");
		return "running" as const;
	}
	override async stop() {
		this.calls.push("stop");
	}
	override async start() {
		this.calls.push("start");
	}
}
function runtime(fixture: Awaited<ReturnType<typeof createLifecycleFixture>>) {
	return async () => ({
		configPath: fixture.configPath,
		config: fixture.config,
		databaseUrl: fixture.databaseUrl,
		pool: fixture.pool,
		db: fixture.db,
		packageVersion: "0.2.5",
		async close() {},
	});
}
describe("CLI PostgreSQL backup and restore", () => {
	it("wraps a backup in service stop/start and reports a redacted restore preview", async () => {
		const fixture = await createLifecycleFixture();
		try {
			const service = new FakeService();
			const output = path.join(fixture.directory, "cli-backup");
			const backup = await runCli(["backup", output, "--yes"], {
				openRuntime: runtime(fixture),
				service,
				environment: {},
			});
			expect(backup.exitCode).toBe(0);
			expect(service.calls).toEqual(["status", "stop", "start"]);
			expect(existsSync(`${output}.qingyan-backup/manifest.json`)).toBe(true);
			const preview = await runCli([
				"restore",
				`${output}.qingyan-backup`,
				"--dry-run",
				"--config",
				fixture.configPath,
			]);
			expect(preview.exitCode).toBe(0);
			expect(preview.output.stdout.join(" ")).toContain("PostgreSQL");
			expect(preview.output.stdout.join(" ")).not.toContain(
				fixture.databaseUrl,
			);
		} finally {
			await fixture.cleanup();
		}
	});
	it("restores into an empty target, preserves source data and generates a separate target config", async () => {
		const source = await createLifecycleFixture();
		const target = await createLifecycleFixture({ empty: true });
		try {
			const backup = await new FullBackupService({
				configPath: source.configPath,
				config: source.config,
				pool: source.pool,
				packageVersion: "0.2.5",
			}).createBackup({
				outputPath: path.join(source.directory, "restore-source"),
			});
			mkdirSync(path.dirname(target.configPath), { recursive: true });
			const generated = path.join(
				path.dirname(target.configPath),
				"restored.yml",
			);
			const service = new RestoreService({
				currentVersion: "0.2.5",
				currentConfigPath: source.configPath,
			});
			expect(
				await service.apply({
					backupPath: backup.outputDirectory,
					database: target.config.database,
					outputConfigPath: generated,
					confirm: "RESTORE QINGYAN",
				}),
			).toMatchObject({ configPath: generated, configurationSwitched: false });
			expect(
				(await target.pool.query("SELECT site_key,name FROM sites")).rows,
			).toEqual(
				(await source.pool.query("SELECT site_key,name FROM sites")).rows,
			);
			expect(
				(
					await target.pool.query(
						"SELECT username,password_hash FROM admin_users",
					)
				).rows,
			).toEqual(
				(
					await source.pool.query(
						"SELECT username,password_hash FROM admin_users",
					)
				).rows,
			);
			expect(readFileSync(source.configPath, "utf8")).toContain(
				source.databaseUrl,
			);
			expect(readFileSync(generated, "utf8")).toContain(target.databaseUrl);
			await expect(
				service.apply({
					backupPath: backup.outputDirectory,
					database: target.config.database,
					outputConfigPath: `${generated}.second`,
					confirm: "RESTORE QINGYAN",
				}),
			).rejects.toThrow("RESTORE_TARGET_NOT_EMPTY");
		} finally {
			await target.cleanup();
			await source.cleanup();
		}
	});
	it("rolls back an interrupted custom archive restore without generating target config", async () => {
		const source = await createLifecycleFixture();
		const target = await createLifecycleFixture({ empty: true });
		try {
			const backup = await new FullBackupService({
				configPath: source.configPath,
				config: source.config,
				pool: source.pool,
				packageVersion: "0.2.5",
			}).createBackup({
				outputPath: path.join(source.directory, "corrupt-restore"),
			});
			const dump = backup.manifest.files.find(
				(file) => file.role === "database",
			);
			if (!dump) throw new Error("dump missing");
			const dumpPath = path.join(backup.outputDirectory, dump.path);
			const bytes = readFileSync(dumpPath);
			writeFileSync(
				dumpPath,
				bytes.subarray(0, Math.floor(bytes.length * 0.7)),
			);
			dump.sha256 = createHash("sha256")
				.update(readFileSync(dumpPath))
				.digest("hex");
			writeFileSync(backup.manifestPath, JSON.stringify(backup.manifest));
			const configPath = path.join(target.directory, "failed-restored.yml");
			const restore = new RestoreService({
				currentVersion: "0.2.5",
				currentConfigPath: source.configPath,
			});
			await expect(
				restore.apply({
					backupPath: backup.outputDirectory,
					database: target.config.database,
					outputConfigPath: configPath,
					confirm: "RESTORE QINGYAN",
				}),
			).rejects.toThrow("PG_RESTORE_FAILED");
			expect(
				(
					await target.pool.query(
						"SELECT tablename FROM pg_tables WHERE schemaname='public'",
					)
				).rows,
			).toEqual([]);
			expect(existsSync(configPath)).toBe(false);
		} finally {
			await target.cleanup();
			await source.cleanup();
		}
	});
});
