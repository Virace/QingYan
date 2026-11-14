import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writePartialUpgradeMarker } from "../../src/modules/upgrade/partial-marker";
import { resolveStartupMode } from "../../src/startup-mode";
import { createLifecycleFixture } from "../support/lifecycle-fixture";

describe("server startup mode", () => {
	it("routes an uninstalled instance to the minimal install app", async () => {
		const fixture = await createLifecycleFixture({ empty: true });
		try {
			expect(
				await resolveStartupMode({
					installed: false,
					configPath: fixture.configPath,
					currentApplicationVersion: "0.2.5",
					partialUpgradeMarkerPath: fixture.markerPath,
				}),
			).toMatchObject({ mode: "install" });
		} finally {
			await fixture.cleanup();
		}
	});
	it.each([
		["0.2.4", "upgrade"],
		["0.2.5", "normal"],
		["0.2.6", "upgrade"],
	])("routes version %s to %s", async (version, mode) => {
		const fixture = await createLifecycleFixture({ version });
		try {
			expect(
				await resolveStartupMode({
					installed: true,
					configPath: fixture.configPath,
					currentApplicationVersion: "0.2.5",
					partialUpgradeMarkerPath: fixture.markerPath,
				}),
			).toMatchObject({ mode });
		} finally {
			await fixture.cleanup();
		}
	});
	it("recognizes legacy SQLite configuration before parsing the new config", async () => {
		const fixture = await createLifecycleFixture({ empty: true });
		try {
			mkdirSync(path.dirname(fixture.configPath), { recursive: true });
			writeFileSync(
				fixture.configPath,
				"database:\n  client: sqlite\n  sqlite:\n    file: old.db\n",
			);
			expect(
				await resolveStartupMode({
					installed: true,
					configPath: fixture.configPath,
					currentApplicationVersion: "0.2.5",
					partialUpgradeMarkerPath: fixture.markerPath,
				}),
			).toMatchObject({
				mode: "upgrade",
				state: {
					state: "broken_config",
					reason: "sqlite_offline_conversion_required",
				},
			});
		} finally {
			await fixture.cleanup();
		}
	});
	it("does not load normal service with a partial upgrade marker", async () => {
		const fixture = await createLifecycleFixture();
		try {
			writePartialUpgradeMarker({
				markerPath: fixture.markerPath,
				fromVersion: "0.2.4",
				toVersion: "0.2.5",
				currentStep: "application-upgrades",
				planPath: "plan",
				backupDirectory: "backup",
			});
			expect(
				await resolveStartupMode({
					installed: true,
					configPath: fixture.configPath,
					currentApplicationVersion: "0.2.5",
					partialUpgradeMarkerPath: fixture.markerPath,
				}),
			).toMatchObject({
				mode: "upgrade",
				state: { state: "recovery_required" },
			});
		} finally {
			await fixture.cleanup();
		}
	});
});
