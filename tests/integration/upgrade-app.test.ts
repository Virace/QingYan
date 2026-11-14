import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	createUpgradeApp,
	createUpgradeAppLaunch,
} from "../../src/modules/upgrade/upgrade-app";
import { createLifecycleFixture } from "../support/lifecycle-fixture";

function options(fixture: Awaited<ReturnType<typeof createLifecycleFixture>>) {
	return {
		configPath: fixture.configPath,
		loadedConfig: fixture.config,
		currentApplicationVersion: "0.2.5",
		partialUpgradeMarkerPath: fixture.markerPath,
		backupDirectory: path.join(fixture.directory, "web-upgrade"),
	};
}
describe("Web PostgreSQL upgrade", () => {
	it("exposes only minimal upgrade routes and its current mode", async () => {
		const fixture = await createLifecycleFixture({ version: "0.2.4" });
		const app = createUpgradeApp({
			...options(fixture),
			token: "upgrade-token",
		});
		try {
			expect((await app.inject("/qingyan/upgrade")).statusCode).toBe(200);
			expect(
				(await app.inject("/qingyan/api/upgrade/state")).json(),
			).toMatchObject({ state: "upgrade_required" });
			expect((await app.inject("/qingyan/healthz")).json()).toMatchObject({
				mode: "upgrade",
			});
			expect((await app.inject("/qingyan/api/admin/session")).statusCode).toBe(
				404,
			);
			expect((await app.inject("/qingyan/admin/install")).statusCode).toBe(404);
		} finally {
			await app.close();
			await fixture.cleanup();
		}
	});
	it("requires token and exact confirmation", async () => {
		const fixture = await createLifecycleFixture({ version: "0.2.4" });
		const app = createUpgradeApp({
			...options(fixture),
			token: "upgrade-token",
		});
		try {
			for (const [payload, status] of [
				[{ token: "wrong", confirm: "UPGRADE QINGYAN" }, 403],
				[{ token: "upgrade-token", confirm: "yes" }, 400],
			] as const)
				expect(
					(
						await app.inject({
							method: "POST",
							url: "/qingyan/api/upgrade/apply",
							payload,
						})
					).statusCode,
				).toBe(status);
		} finally {
			await app.close();
			await fixture.cleanup();
		}
	});
	it("announces an authorization token and applies a confirmed upgrade", async () => {
		const fixture = await createLifecycleFixture({ version: "0.2.4" });
		const launch = createUpgradeAppLaunch({
			...options(fixture),
			tokenFactory: () => "launch-token",
		});
		try {
			const lines: string[] = [];
			launch.announce({
				url: "http://localhost/upgrade",
				state: "upgrade_required",
				output: (line) => lines.push(line),
			});
			expect(lines).toContain("upgrade.token=launch-token");
			const response = await launch.app.inject({
				method: "POST",
				url: "/qingyan/api/upgrade/apply",
				payload: { token: "launch-token", confirm: "UPGRADE QINGYAN" },
			});
			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				state: "applied",
				restartRequired: true,
			});
			expect(
				(
					await launch.app.inject({
						method: "POST",
						url: "/qingyan/api/upgrade/apply",
						payload: { token: "launch-token", confirm: "UPGRADE QINGYAN" },
					})
				).statusCode,
			).toBe(409);
		} finally {
			await launch.app.close();
			await fixture.cleanup();
		}
	});
	it("renders broken configuration without exposing raw errors", async () => {
		const app = createUpgradeApp({
			configPath: "missing.yml",
			configError: new Error("secret-raw-error"),
			currentApplicationVersion: "0.2.5",
			partialUpgradeMarkerPath: "missing-marker",
			token: "token",
		});
		try {
			const response = await app.inject("/qingyan/upgrade");
			expect(response.body).toContain("broken_config");
			expect(response.body).not.toContain("secret-raw-error");
		} finally {
			await app.close();
		}
	});
});
