import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
	readPartialUpgradeMarker,
	removePartialUpgradeMarker,
	updatePartialUpgradeMarker,
	writePartialUpgradeMarker,
} from "../../src/modules/upgrade/partial-marker";

function createWorkspace() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-upgrade-marker-"));
	return {
		directory,
		markerPath: path.join(directory, "data", "upgrade", "partial-upgrade.json"),
		cleanup() {
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

describe("partial upgrade marker", () => {
	it("writes, updates, reads, and removes a partial marker", () => {
		const workspace = createWorkspace();
		try {
			const marker = writePartialUpgradeMarker({
				markerPath: workspace.markerPath,
				fromVersion: "0.0.1",
				toVersion: "0.1.0",
				planPath:
					"data/backups/upgrades/upgrade_20260507000000/upgrade-plan.json",
				backupDirectory: "data/backups/upgrades/upgrade_20260507000000",
				currentStep: "backup",
				now: () => new Date("2026-05-07T00:00:00.000Z"),
			});

			expect(readPartialUpgradeMarker(workspace.markerPath)).toEqual(marker);
			updatePartialUpgradeMarker(workspace.markerPath, {
				currentStep: "application-upgrades",
			});
			expect(readPartialUpgradeMarker(workspace.markerPath)?.currentStep).toBe(
				"application-upgrades",
			);

			removePartialUpgradeMarker(workspace.markerPath);
			expect(existsSync(workspace.markerPath)).toBe(false);
			expect(readPartialUpgradeMarker(workspace.markerPath)).toBeNull();
		} finally {
			workspace.cleanup();
		}
	});

	it("returns recovery details for malformed marker JSON", () => {
		const workspace = createWorkspace();
		try {
			mkdirSync(path.dirname(workspace.markerPath), { recursive: true });
			writeFileSync(workspace.markerPath, "{", "utf-8");

			expect(readPartialUpgradeMarker(workspace.markerPath)).toMatchObject({
				kind: "qingyan_partial_upgrade",
				currentStep: "marker_read_failed",
				error: expect.stringContaining("Expected"),
			});
		} finally {
			workspace.cleanup();
		}
	});
});
