import { afterEach, describe, expect, it } from "vitest";

import { adminBootstrapState } from "../../src/db/schema";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin bootstrap", () => {
	it("generates and persists missing console path and credentials", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.admin.console.path = undefined;
				config.admin.auth.username = undefined;
				config.admin.auth.passwordHash = undefined;
			},
		});
		cleanups.push(fixture.cleanup);

		const rows = await fixture.app.db.select().from(adminBootstrapState);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.consolePath).toMatch(/^\/qy-[A-Za-z0-9]+$/);
		expect(rows[0]?.username).toMatch(/^admin_[A-Za-z0-9]+$/);
		expect(rows[0]?.passwordHash).toMatch(/^scrypt:/);
		expect(fixture.app.adminBootstrap.generatedPassword).toBeTruthy();

		const response = await fixture.app.inject({
			method: "GET",
			url: rows[0]?.consolePath ?? "/missing",
		});
		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("QingYan Admin");
	});

	it("uses fixed credentials in dev mode", async () => {
		const fixture = await createTestApp({
			devMode: true,
			mutateConfig(config) {
				config.admin.auth.username = undefined;
				config.admin.auth.passwordHash = undefined;
			},
		});
		cleanups.push(fixture.cleanup);

		const rows = await fixture.app.db.select().from(adminBootstrapState);
		expect(rows).toHaveLength(0);
		expect(fixture.app.adminBootstrap).toMatchObject({
			consolePath: "/admin",
			username: "admin",
			generatedPassword: "admin",
		});
	});
});
