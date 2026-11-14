import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { writePartialUpgradeMarker } from "../../src/modules/upgrade/partial-marker";
import { detectUpgradeRuntimeState } from "../../src/modules/upgrade/state";
import { createLifecycleFixture } from "../support/lifecycle-fixture";

describe("PostgreSQL lifecycle classification", () => {
	it("classifies an empty target without creating tables", async () => {
		const fixture = await createLifecycleFixture({ empty: true });
		try {
			const state = await detectUpgradeRuntimeState({
				configPath: fixture.configPath,
				loadedConfig: fixture.config,
				currentApplicationVersion: "0.2.5",
			});
			expect(state).toEqual({ state: "not_installed" });
			expect(
				(
					await fixture.pool.query(
						"SELECT tablename FROM pg_tables WHERE schemaname='public'",
					)
				).rows,
			).toEqual([]);
			expect(existsSync(fixture.configPath)).toBe(false);
		} finally {
			await fixture.cleanup();
		}
	});
	it.each([
		["0.2.5", "normal_current"],
		["0.2.4", "upgrade_required"],
		["0.2.6", "broken_config"],
	])("classifies application version %s", async (version, state) => {
		const fixture = await createLifecycleFixture({ version });
		try {
			expect(
				await detectUpgradeRuntimeState({
					configPath: fixture.configPath,
					loadedConfig: fixture.config,
					currentApplicationVersion: "0.2.5",
				}),
			).toMatchObject({ state });
		} finally {
			await fixture.cleanup();
		}
	});
	it("prioritizes partial marker over broken config", async () => {
		const fixture = await createLifecycleFixture({ empty: true });
		try {
			writePartialUpgradeMarker({
				markerPath: fixture.markerPath,
				fromVersion: "0.2.4",
				toVersion: "0.2.5",
				planPath: "plan.json",
				backupDirectory: "backup",
				currentStep: "application-upgrades",
			});
			expect(
				await detectUpgradeRuntimeState({
					configPath: fixture.configPath,
					configError: new Error("invalid"),
					currentApplicationVersion: "0.2.5",
					partialUpgradeMarkerPath: fixture.markerPath,
				}),
			).toMatchObject({
				state: "recovery_required",
				reason: "partial_upgrade_marker",
			});
		} finally {
			await fixture.cleanup();
		}
	});
	it("requires the same conversion ID to complete conversion", async () => {
		const fixture = await createLifecycleFixture();
		try {
			await fixture.pool.query(
				"INSERT INTO __qingyan_upgrades(name,to_version,summary_json) VALUES('sqlite-to-postgresql-started','0.2.5',$1),('sqlite-to-postgresql-completed','0.2.5',$2)",
				[
					JSON.stringify({ conversionId: "source-a" }),
					JSON.stringify({ conversionId: "source-b" }),
				],
			);
			expect(
				await detectUpgradeRuntimeState({
					configPath: fixture.configPath,
					loadedConfig: fixture.config,
					currentApplicationVersion: "0.2.5",
				}),
			).toMatchObject({ state: "recovery_required" });
			await fixture.pool.query(
				"UPDATE __qingyan_upgrades SET summary_json=$1 WHERE name='sqlite-to-postgresql-completed'",
				[JSON.stringify({ conversionId: "source-a" })],
			);
			expect(
				await detectUpgradeRuntimeState({
					configPath: fixture.configPath,
					loadedConfig: fixture.config,
					currentApplicationVersion: "0.2.5",
				}),
			).toEqual({ state: "normal_current" });
		} finally {
			await fixture.cleanup();
		}
	});
	it("rejects an unknown migration before normal startup", async () => {
		const fixture = await createLifecycleFixture();
		try {
			await fixture.pool.query(
				"INSERT INTO __qingyan_migrations(name,checksum) VALUES('9999_future.sql','unknown')",
			);
			expect(
				await detectUpgradeRuntimeState({
					configPath: fixture.configPath,
					loadedConfig: fixture.config,
					currentApplicationVersion: "0.2.5",
				}),
			).toMatchObject({
				state: "broken_config",
				reason: "database_schema_too_new",
			});
		} finally {
			await fixture.cleanup();
		}
	});
	it("connection failure never classifies as an empty target", async () => {
		const fixture = await createLifecycleFixture({ empty: true });
		try {
			fixture.config.database.url =
				"postgresql://invalid:invalid@127.0.0.1:1/invalid";
			expect(
				await detectUpgradeRuntimeState({
					configPath: fixture.configPath,
					loadedConfig: fixture.config,
					currentApplicationVersion: "0.2.5",
				}),
			).toMatchObject({
				state: "broken_config",
				reason: "database_unavailable",
			});
		} finally {
			await fixture.cleanup();
		}
	});
});
