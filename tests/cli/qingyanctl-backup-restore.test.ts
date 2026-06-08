import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/main";
import type { CliRuntime } from "../../src/cli/runtime";
import { createDatabaseClients } from "../../src/db/client";
import { adminBootstrapState } from "../../src/db/schema";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { SystemdServiceController } from "../../src/modules/service-control/systemd-service";
import {
	applyInitialMigration,
	createTestConfig,
} from "../support/test-fixtures";

class FakeService extends SystemdServiceController {
	public calls: string[] = [];

	public constructor(private readonly initialState: "running" | "stopped") {
		super({
			platform: "linux",
			runner: async () => ({ code: 0, stdout: "", stderr: "" }),
		});
	}

	public override async status() {
		this.calls.push("status");
		return this.initialState;
	}

	public override async stop() {
		this.calls.push("stop");
	}

	public override async start() {
		this.calls.push("start");
	}
}

function createRuntimeFixture() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-cli-backup-"));
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
		directory,
		configPath,
		databaseFile,
		config,
		db,
		sqlite,
		async seedAdmin() {
			await db.insert(adminBootstrapState).values({
				id: 1,
				consolePath: "/admin",
				username: "admin",
				passwordHash: createPasswordHash("password"),
				passwordRotatedAt: null,
			});
		},
		openRuntime: async (): Promise<CliRuntime> => ({
			configPath,
			config,
			databaseFile,
			sqlite,
			db,
			packageVersion: "0.1.0",
			close() {},
		}),
		cleanup() {
			sqlite.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

describe("qingyanctl backup and restore commands", () => {
	it("creates a full backup with service wrapping", async () => {
		const fixture = createRuntimeFixture();
		try {
			await fixture.seedAdmin();
			const service = new FakeService("running");
			const outputPath = path.join(fixture.directory, "backup");

			const result = await runCli(["backup", outputPath, "--yes"], {
				openRuntime: fixture.openRuntime,
				service,
				environment: {
					QINGYAN_SMTP_PASSWORD: "raw-secret",
				},
			});

			expect(result.exitCode).toBe(0);
			expect(service.calls).toEqual(["status", "stop", "start"]);
			expect(existsSync(`${outputPath}.qingyan-backup/manifest.json`)).toBe(
				true,
			);
			expect(result.output.stdout.join("\n")).toContain(
				"QINGYAN_SMTP_PASSWORD",
			);
			expect(result.output.stdout.join("\n")).not.toContain("raw-secret");
		} finally {
			fixture.cleanup();
		}
	});

	it("prints restore dry-run plans from a manifest", async () => {
		const fixture = createRuntimeFixture();
		try {
			const backupDirectory = path.join(fixture.directory, "manual-backup");
			rmSync(backupDirectory, { recursive: true, force: true });
			mkdirSync(backupDirectory, { recursive: true });
			writeFileSync(
				path.join(fixture.directory, "unused.txt"),
				"unused",
				"utf-8",
			);
			await fixture.seedAdmin();
			const backupResult = await runCli(["backup", backupDirectory, "--yes"], {
				openRuntime: fixture.openRuntime,
				service: new FakeService("stopped"),
			});
			expect(backupResult.exitCode).toBe(0);

			const result = await runCli([
				"restore",
				`${backupDirectory}.qingyan-backup`,
				"--dry-run",
			]);

			expect(result.exitCode).toBe(0);
			expect(result.output.stdout.join("\n")).toContain("备份版本");
			expect(result.output.stdout.join("\n")).toContain("恢复后需要升级");
		} finally {
			fixture.cleanup();
		}
	});
});
