import { existsSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { databaseIdentity } from "../../src/modules/database-backup/postgres-tools";
import { writePartialUpgradeMarker } from "../../src/modules/upgrade/partial-marker";
import {
	type RegisteredApplicationUpgrade,
	UpgradeService,
} from "../../src/modules/upgrade/upgrade-service";
import { createLifecycleFixture } from "../support/lifecycle-fixture";

function service(
	fixture: Awaited<ReturnType<typeof createLifecycleFixture>>,
	steps: RegisteredApplicationUpgrade[] = [],
) {
	return new UpgradeService({
		configPath: fixture.configPath,
		loadedConfig: fixture.config,
		currentApplicationVersion: "0.2.5",
		partialUpgradeMarkerPath: fixture.markerPath,
		registeredApplicationUpgrades: steps,
	});
}
describe("PostgreSQL UpgradeService", () => {
	it("backs up before writes and records the application version once", async () => {
		const fixture = await createLifecycleFixture({ version: "0.2.4" });
		try {
			const upgrade = service(fixture);
			const result = await upgrade.apply({
				confirm: "UPGRADE QINGYAN",
				backupDirectory: path.join(fixture.directory, "backup"),
			});
			expect(result.state).toBe("applied");
			expect(existsSync(result.backup.databaseBackupPath)).toBe(true);
			expect(existsSync(fixture.markerPath)).toBe(false);
			expect(await upgrade.detect()).toEqual({ state: "normal_current" });
			expect(
				(
					await fixture.pool.query(
						"SELECT name FROM __qingyan_upgrades WHERE name='application-version:0.2.5'",
					)
				).rowCount,
			).toBe(1);
			await expect(
				upgrade.apply({ confirm: "UPGRADE QINGYAN" }),
			).rejects.toThrow("UPGRADE_STATE_INVALID");
		} finally {
			await fixture.cleanup();
		}
	});
	it("does not mutate application state when backup fails", async () => {
		const fixture = await createLifecycleFixture({ version: "0.2.4" });
		try {
			const blocker = path.join(fixture.directory, "blocker");
			writeFileSync(blocker, "file");
			await expect(
				service(fixture).apply({
					confirm: "UPGRADE QINGYAN",
					backupDirectory: path.join(blocker, "backup"),
				}),
			).rejects.toThrow();
			expect(
				(
					await fixture.pool.query(
						"SELECT name FROM __qingyan_upgrades WHERE name='application-version:0.2.5'",
					)
				).rowCount,
			).toBe(0);
			expect(existsSync(fixture.markerPath)).toBe(true);
			expect(await service(fixture).detect()).toMatchObject({
				state: "recovery_required",
			});
		} finally {
			await fixture.cleanup();
		}
	});
	it("rolls back data and completion ledger together on application step failure", async () => {
		const fixture = await createLifecycleFixture({ version: "0.2.4" });
		try {
			const step: RegisteredApplicationUpgrade = {
				name: "fixture-failure",
				toVersion: "0.2.5",
				describe: () => ({ name: "fixture-failure", toVersion: "0.2.5" }),
				async apply(context) {
					await context.db.execute(sql`UPDATE sites SET name='must-rollback'`);
					throw new Error("APPLICATION_STEP_FAILED");
				},
			};
			await expect(
				service(fixture, [step]).apply({
					confirm: "UPGRADE QINGYAN",
					backupDirectory: path.join(fixture.directory, "backup"),
				}),
			).rejects.toThrow("APPLICATION_STEP_FAILED");
			expect(
				(await fixture.pool.query("SELECT name FROM sites")).rows[0].name,
			).toBe("Default");
			expect(
				(
					await fixture.pool.query(
						"SELECT name FROM __qingyan_upgrades WHERE name IN ('application-version:0.2.5','fixture-failure')",
					)
				).rowCount,
			).toBe(0);
			expect(existsSync(fixture.markerPath)).toBe(true);
		} finally {
			await fixture.cleanup();
		}
	});
	it("requires exact confirmation before starting a backup", async () => {
		const fixture = await createLifecycleFixture({ version: "0.2.4" });
		try {
			await expect(service(fixture).apply({ confirm: "yes" })).rejects.toThrow(
				"UPGRADE_CONFIRMATION_REQUIRED",
			);
			expect(existsSync(fixture.markerPath)).toBe(false);
		} finally {
			await fixture.cleanup();
		}
	});
	it("finishes a staged configuration switch only for the matching completed database", async () => {
		const fixture = await createLifecycleFixture();
		try {
			const stagedConfigPath = `${fixture.configPath}.staged`;
			renameSync(fixture.configPath, stagedConfigPath);
			writePartialUpgradeMarker({
				markerPath: fixture.markerPath,
				fromVersion: "not_installed",
				toVersion: "0.2.5",
				planPath: "",
				backupDirectory: "",
				currentStep: "database-completed",
				stagedConfigPath,
				targetIdentity: databaseIdentity(fixture.databaseUrl),
			});
			const recovery = new UpgradeService({
				configPath: fixture.configPath,
				configError: new Error("config missing"),
				currentApplicationVersion: "0.2.5",
				partialUpgradeMarkerPath: fixture.markerPath,
			});
			await recovery.recover({ confirm: "UPGRADE QINGYAN" });
			expect(existsSync(fixture.configPath)).toBe(true);
			expect(existsSync(stagedConfigPath)).toBe(false);
			expect(existsSync(fixture.markerPath)).toBe(false);
			expect(
				(await fixture.pool.query("SELECT username FROM admin_users")).rows,
			).toEqual([{ username: "admin" }]);
		} finally {
			await fixture.cleanup();
		}
	});
});
