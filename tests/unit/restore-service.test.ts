import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { RestoreService } from "../../src/modules/backup/restore-service";

function createManifest(version: string) {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-restore-"));
	writeFileSync(
		path.join(directory, "manifest.json"),
		JSON.stringify({
			format: "qingyan.full-backup",
			formatVersion: 1,
			qingyanVersion: version,
			database: { client: "sqlite" },
			config: { path: "data/qingyan.yml" },
			files: [{ path: "database/qingyan.sqlite", role: "database" }],
		}),
		"utf-8",
	);
	return {
		directory,
		cleanup() {
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

describe("RestoreService", () => {
	it("does not require upgrade for same-version backups", () => {
		const manifest = createManifest("0.1.0");
		try {
			const service = new RestoreService({
				currentVersion: "0.1.0",
				currentConfigPath: "data/qingyan.yml",
			});

			expect(service.plan({ backupPath: manifest.directory })).toMatchObject({
				backupVersion: "0.1.0",
				currentVersion: "0.1.0",
				databaseClient: "sqlite",
				upgradeRequired: false,
			});
		} finally {
			manifest.cleanup();
		}
	});

	it("requires upgrade for older backups", () => {
		const manifest = createManifest("0.0.9");
		try {
			const service = new RestoreService({
				currentVersion: "0.1.0",
				currentConfigPath: "data/qingyan.yml",
			});

			expect(service.plan({ backupPath: manifest.directory })).toMatchObject({
				backupVersion: "0.0.9",
				currentVersion: "0.1.0",
				upgradeRequired: true,
			});
		} finally {
			manifest.cleanup();
		}
	});
});
