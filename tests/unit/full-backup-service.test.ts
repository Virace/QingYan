import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { adminBootstrapState } from "../../src/db/schema";
import { FullBackupService } from "../../src/modules/backup/full-backup-service";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import {
	applyInitialMigration,
	createTestConfig,
} from "../support/test-fixtures";

function createWorkspace() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-full-backup-"));
	const databaseFile = path.join(directory, "qingyan.db");
	const configPath = path.join(directory, "qingyan.yml");
	applyInitialMigration(databaseFile);
	const { db, sqlite } = createDatabaseClients(databaseFile);
	const config = createTestConfig(databaseFile, path.join(directory, "logs"));
	writeFileSync(
		configPath,
		stringify({
			server: config.server,
			database: config.database,
			admin: { session: config.admin.session },
			security: config.security,
		}),
		"utf-8",
	);
	return {
		config,
		configPath,
		databaseFile,
		db,
		sqlite,
		directory,
		async seedAdmin() {
			await db.insert(adminBootstrapState).values({
				id: 1,
				consolePath: "/hidden-admin",
				username: "admin",
				passwordHash: createPasswordHash("password"),
				passwordRotatedAt: null,
			});
		},
		close() {
			sqlite.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

describe("FullBackupService", () => {
	it("creates a full backup manifest without environment secret values", async () => {
		const workspace = createWorkspace();
		try {
			await workspace.seedAdmin();
			const service = new FullBackupService({
				configPath: workspace.configPath,
				config: workspace.config,
				databaseFile: workspace.databaseFile,
				sqlite: workspace.sqlite,
				packageVersion: "0.1.0",
				env: {
					QINGYAN_SMTP_PASSWORD: "raw-secret",
					QINGYAN_PUBLIC_BASE_URL: "https://example.com",
				},
				now: () => new Date("2026-05-07T00:00:00.000Z"),
			});

			const result = await service.createBackup({
				outputPath: path.join(workspace.directory, "backup"),
			});
			const manifestText = JSON.stringify(result.manifest);

			expect(result.manifest).toMatchObject({
				format: "qingyan.full-backup",
				formatVersion: 1,
				qingyanVersion: "0.1.0",
				config: {
					adminConsolePath: "/hidden-admin",
				},
			});
			expect(result.manifest.environment.detected).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "QINGYAN_SMTP_PASSWORD",
						secret: true,
						included: false,
					}),
					expect.objectContaining({
						name: "QINGYAN_PUBLIC_BASE_URL",
						secret: false,
						included: false,
					}),
				]),
			);
			expect(manifestText).not.toContain("raw-secret");
			expect(
				existsSync(path.join(result.outputDirectory, "manifest.json")),
			).toBe(true);
			expect(
				existsSync(
					path.join(result.outputDirectory, "database", "qingyan.sqlite"),
				),
			).toBe(true);
		} finally {
			workspace.close();
		}
	});
});
