import { afterEach, describe, expect, it } from "vitest";

import { adminBootstrapState } from "../../src/db/schema";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

async function seedInstalledBootstrap(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
) {
	await fixture.app.db.insert(adminBootstrapState).values({
		id: 1,
		consolePath: "/admin",
		username: "admin",
		passwordHash: createPasswordHash("replace-me"),
		passwordRotatedAt: null,
	});
}

describe("admin ops routes", () => {
	it("requires an admin session", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/ops/status",
		});

		expect(response.statusCode).toBe(401);
	});

	it("returns shared operations status", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const { adminCookie } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/ops/status",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			version: {
				current: "0.1.0",
			},
			update: {
				supported: true,
				entry: "service-action",
				estimatedRestartSeconds: {
					min: 30,
					max: 60,
				},
				check: {
					state: "not_checked",
					currentVersion: "0.1.0",
					autoUpdatable: false,
					source: {
						provider: "github-releases",
						owner: "Virace",
						repo: "QingYan",
						url: "https://github.com/Virace/QingYan",
					},
				},
			},
			upgrade: {
				state: "normal_current",
			},
			backup: {
				format: "qingyan.full-backup",
				provider: "sqlite",
			},
			recovery: {
				manualCommands: [
					"systemctl status qingyan.service",
					"journalctl -u qingyan.service -n 120 --no-pager",
					"qyctl status",
				],
			},
		});
	});

	it("returns update plan without executing update", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/update/plan",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			kind: "program-update",
			executor: "qingyan.service",
			estimatedRestartSeconds: {
				min: 30,
				max: 60,
			},
			manualCommands: expect.arrayContaining(["qyctl status"]),
		});
	});

	it("requires an admin session to check for updates", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/update/check",
		});

		expect(response.statusCode).toBe(401);
	});

	it("returns the shared upgrade dry-run state", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/upgrade/dry-run",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			state: "normal_current",
		});
	});
});
