import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runUpgradeCli } from "../../scripts/upgrade";
import { createLifecycleFixture } from "../support/lifecycle-fixture";

describe("upgrade script", () => {
	it.each([
		"--config",
		"--backup-dir",
		"--partial-marker",
	])("rejects %s without a value", async (option) => {
		await expect(runUpgradeCli(["--dry-run", option])).rejects.toThrow(
			"requires a value",
		);
	});
	it("previews without writing the upgrade ledger", async () => {
		const fixture = await createLifecycleFixture({ version: "0.2.4" });
		const output = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(
				await runUpgradeCli(["--dry-run", "--config", fixture.configPath]),
			).toBe(0);
			expect(output.mock.calls.flat().join(" ")).toContain(
				"application-version:0.2.5",
			);
			expect(
				(
					await fixture.pool.query(
						"SELECT name FROM __qingyan_upgrades WHERE name='application-version:0.2.5'",
					)
				).rowCount,
			).toBe(0);
			expect(existsSync(fixture.markerPath)).toBe(false);
		} finally {
			output.mockRestore();
			await fixture.cleanup();
		}
	});
	it("requires a backup directory before applying", async () => {
		const fixture = await createLifecycleFixture({ version: "0.2.4" });
		try {
			await expect(
				runUpgradeCli(["--apply", "--config", fixture.configPath]),
			).rejects.toThrow("--backup-dir");
			expect(
				(
					await fixture.pool.query(
						"SELECT name FROM __qingyan_upgrades WHERE name='application-version:0.2.5'",
					)
				).rowCount,
			).toBe(0);
		} finally {
			await fixture.cleanup();
		}
	});
});
