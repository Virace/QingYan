import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/main";
import type { CliRuntime } from "../../src/cli/runtime";
import { createDatabaseClients } from "../../src/db/client";
import {
	adminBootstrapState,
	pageThreads,
	pendingPageCandidates,
	pendingPageViewSessions,
	sitePageRegistry,
	sites,
} from "../../src/db/schema";
import {
	createPasswordHash,
	verifyPasswordHash,
} from "../../src/modules/admin/password-hash";
import { SystemdServiceController } from "../../src/modules/service-control/systemd-service";
import {
	applyInitialMigration,
	createTestConfig,
} from "../support/test-fixtures";

class FakeService extends SystemdServiceController {
	public calls: string[] = [];
	public state: "running" | "stopped" = "stopped";

	public constructor(state: "running" | "stopped" = "stopped") {
		super({
			platform: "linux",
			runner: async () => ({ code: 0, stdout: "", stderr: "" }),
		});
		this.state = state;
	}

	public override async status() {
		this.calls.push("status");
		return this.state;
	}

	public override async start() {
		this.calls.push("start");
		this.state = "running";
	}

	public override async stop() {
		this.calls.push("stop");
		this.state = "stopped";
	}

	public override async restart() {
		this.calls.push("restart");
		this.state = "running";
	}
}

function createRuntimeFixture() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-cli-"));
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
		databaseFile,
		configPath,
		config,
		db,
		sqlite,
		async seedAdmin() {
			await db.insert(adminBootstrapState).values({
				id: 1,
				consolePath: "/hidden-admin",
				username: "admin",
				passwordHash: createPasswordHash("old-password"),
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

describe("qingyanctl core commands", () => {
	it("prints help for empty and explicit help commands", async () => {
		for (const args of [[], ["--help"], ["-h"], ["help"]]) {
			const result = await runCli(args);

			expect(result.exitCode).toBe(0);
			expect(result.output.stderr).toEqual([]);
			expect(result.output.stdout.join("\n")).toContain(
				"Usage: qyctl <command> [options]",
			);
			expect(result.output.stdout.join("\n")).toContain("qyctl info");
			expect(result.output.stdout.join("\n")).toContain("qyctl update plan");
		}
	});

	it("prints the package version", async () => {
		for (const args of [["--version"], ["version"]]) {
			const result = await runCli(args);

			expect(result.exitCode).toBe(0);
			expect(result.output.stderr).toEqual([]);
			expect(result.output.stdout).toEqual(["QingYan 0.2.1"]);
		}
	});

	it("prints user-facing info without password", async () => {
		const fixture = createRuntimeFixture();
		try {
			await fixture.seedAdmin();
			const service = new FakeService("running");

			const result = await runCli(["info"], {
				openRuntime: fixture.openRuntime,
				service,
			});

			expect(result.exitCode).toBe(0);
			expect(result.output.stdout.join("\n")).toContain("控制台入口：");
			expect(result.output.stdout.join("\n")).toContain("管理员用户：admin");
			expect(result.output.stdout.join("\n")).not.toContain("password");
			expect(result.output.stdout.join("\n")).not.toContain("密码");
		} finally {
			fixture.cleanup();
		}
	});

	it("resets password with stopped service wrapping", async () => {
		const fixture = createRuntimeFixture();
		try {
			await fixture.seedAdmin();
			const service = new FakeService("running");

			const result = await runCli(["admin", "repass"], {
				openRuntime: fixture.openRuntime,
				service,
			});
			const rows = await fixture.db.select().from(adminBootstrapState);
			const passwordLine = result.output.stdout.find((line) =>
				line.startsWith("新密码："),
			);

			expect(result.exitCode).toBe(0);
			expect(passwordLine?.replace("新密码：", "")).toHaveLength(18);
			expect(
				verifyPasswordHash(
					passwordLine?.replace("新密码：", "") ?? "",
					rows[0]?.passwordHash ?? "",
				),
			).toBe(true);
			expect(service.calls).toEqual(["status", "stop", "start"]);
		} finally {
			fixture.cleanup();
		}
	});

	it("does not echo supplied passwords", async () => {
		const fixture = createRuntimeFixture();
		try {
			await fixture.seedAdmin();
			const result = await runCli(["admin", "repass", "new-password"], {
				openRuntime: fixture.openRuntime,
				service: new FakeService("stopped"),
			});

			expect(result.exitCode).toBe(0);
			expect(result.output.stdout.join("\n")).not.toContain("new-password");
		} finally {
			fixture.cleanup();
		}
	});

	it("resets admin entrance", async () => {
		const fixture = createRuntimeFixture();
		try {
			await fixture.seedAdmin();
			const result = await runCli(["admin", "entrance", "/new-admin"], {
				openRuntime: fixture.openRuntime,
				service: new FakeService("stopped"),
			});
			const rows = await fixture.db.select().from(adminBootstrapState);

			expect(result.exitCode).toBe(0);
			expect(rows[0]?.consolePath).toBe("/new-admin");
			expect(result.output.stdout.join("\n")).toContain("/new-admin");
		} finally {
			fixture.cleanup();
		}
	});

	it("routes service control commands", async () => {
		const service = new FakeService("stopped");

		const result = await runCli(["start"], { service });

		expect(result.exitCode).toBe(0);
		expect(service.calls).toEqual(["start"]);
		expect(result.output.stdout.join("\n")).toContain("服务已启动");
	});

	it("reconciles registered pending page candidates from the CLI", async () => {
		const fixture = createRuntimeFixture();
		try {
			await fixture.db.insert(sites).values({
				id: 1,
				siteKey: "fangyuan",
				name: "FangYuan",
				allowedOriginsJson: JSON.stringify(["https://example.com"]),
			});
			await fixture.db.insert(sitePageRegistry).values({
				siteId: 1,
				pageKey: "posts/registered-pending/",
				pageUrl: "/posts/registered-pending/",
				status: "active",
			});
			await fixture.db.insert(pendingPageCandidates).values({
				siteKey: "fangyuan",
				pageKey: "posts/registered-pending/",
				pageUrl: "/posts/registered-pending/",
				status: "pending",
				hitCount: 2,
			});
			await fixture.db.insert(pendingPageViewSessions).values([
				{
					siteKey: "fangyuan",
					pageKey: "posts/registered-pending/",
					fingerprint: "registered-pending:a",
				},
				{
					siteKey: "fangyuan",
					pageKey: "posts/registered-pending/",
					fingerprint: "registered-pending:b",
				},
			]);
			const service = new FakeService("running");

			const dryRun = await runCli(
				["page-registry", "reconcile-pending", "--site-key", "fangyuan"],
				{
					openRuntime: fixture.openRuntime,
					service,
				},
			);
			expect(dryRun.exitCode).toBe(0);
			expect(dryRun.output.stdout.join("\n")).toContain("模式：dry-run");
			expect(await fixture.db.select().from(pageThreads)).toEqual([]);
			expect(service.calls).toEqual([]);

			const applied = await runCli(
				[
					"page-registry",
					"reconcile-pending",
					"--site-key",
					"fangyuan",
					"--yes",
				],
				{
					openRuntime: fixture.openRuntime,
					service,
				},
			);

			expect(applied.exitCode).toBe(0);
			expect(applied.output.stdout.join("\n")).toContain("模式：apply");
			expect(service.calls).toEqual(["status", "stop", "start"]);
			const [thread] = await fixture.db.select().from(pageThreads);
			expect(thread).toMatchObject({
				pageKey: "posts/registered-pending/",
				pageViewCount: 2,
			});
			const [candidate] = await fixture.db.select().from(pendingPageCandidates);
			expect(candidate?.status).toBe("approved");
		} finally {
			fixture.cleanup();
		}
	});
});
