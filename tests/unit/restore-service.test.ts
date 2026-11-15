import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { RestoreService } from "../../src/modules/backup/restore-service";

function createManifest(version: string, client = "postgresql") {
	const root = path.resolve(".temp/postgresql-migration/testing/workspaces");
	mkdirSync(root, { recursive: true });
	const directory = mkdtempSync(path.join(root, "restore-manifest-"));
	writeFileSync(
		path.join(directory, "manifest.json"),
		JSON.stringify({
			format: "qingyan.full-backup",
			formatVersion: 1,
			qingyanVersion: version,
			database: { client },
			config: { path: "data/qingyan.yml" },
			files: [],
		}),
		"utf-8",
	);
	return {
		directory,
	};
}

describe("RestoreService", () => {
	it("does not require upgrade for same-version backups", () => {
		const manifest = createManifest("0.1.0");
		const service = new RestoreService({
			currentVersion: "0.1.0",
			currentConfigPath: "data/qingyan.yml",
		});

		expect(service.plan({ backupPath: manifest.directory })).toMatchObject({
			backupVersion: "0.1.0",
			currentVersion: "0.1.0",
			databaseClient: "postgresql",
			upgradeRequired: false,
		});
	});

	it("requires upgrade for older backups", () => {
		const manifest = createManifest("0.0.9");
		const service = new RestoreService({
			currentVersion: "0.1.0",
			currentConfigPath: "data/qingyan.yml",
		});

		expect(service.plan({ backupPath: manifest.directory })).toMatchObject({
			backupVersion: "0.0.9",
			currentVersion: "0.1.0",
			upgradeRequired: true,
		});
	});
	it("rejects a retired SQLite backup manifest", () => {
		const manifest = createManifest("0.2.5", "sqlite");
		const service = new RestoreService({
			currentVersion: "0.2.5",
			currentConfigPath: "config/qingyan.yml",
		});
		expect(() => service.plan({ backupPath: manifest.directory })).toThrow();
	});
});
