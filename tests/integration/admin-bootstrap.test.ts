import { afterEach, describe, expect, it } from "vitest";

import { adminBootstrapState } from "../../src/db/schema";
import { resolveAdminBootstrap } from "../../src/modules/admin/bootstrap-service";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
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
				config.admin.console.path = undefined;
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

	it("overrides configured credentials in dev mode", async () => {
		const fixture = await createTestApp({
			devMode: true,
			mutateConfig(config) {
				config.admin.console.path = "/hidden-admin";
				config.admin.auth.username = "installed-admin";
				config.admin.auth.passwordHash = "scrypt:invalid:hash";
			},
		});
		cleanups.push(fixture.cleanup);

		expect(fixture.app.adminBootstrap).toMatchObject({
			consolePath: "/hidden-admin",
			username: "admin",
			generatedPassword: "admin",
		});
	});

	it("keeps existing console path while overriding credentials in dev mode", async () => {
		const fixture = await createTestApp({
			devMode: true,
			mutateConfig(config) {
				config.admin.console.path = undefined;
				config.admin.auth.username = undefined;
				config.admin.auth.passwordHash = undefined;
			},
		});
		cleanups.push(fixture.cleanup);

		await fixture.app.db.insert(adminBootstrapState).values({
			id: 1,
			consolePath: "/hidden-admin",
			username: "installed-admin",
			passwordHash: createPasswordHash("installed-password"),
			passwordRotatedAt: null,
		});
		const bootstrap = await resolveAdminBootstrap(
			fixture.app.config,
			fixture.app.db,
			{
				devMode: {
					enabled: true,
					adminUsername: "admin",
					adminPassword: "admin",
				},
			},
		);

		expect(bootstrap).toMatchObject({
			consolePath: "/hidden-admin",
			username: "admin",
			generatedPassword: "admin",
		});
	});

	it("serves /admin as a dev-only admin UI alias", async () => {
		const fixture = await createTestApp({
			devMode: true,
			mutateConfig(config) {
				config.admin.console.path = "/hidden-admin";
			},
		});
		cleanups.push(fixture.cleanup);

		const configuredRoute = await fixture.app.inject({
			method: "GET",
			url: "/hidden-admin",
		});
		const devAlias = await fixture.app.inject({
			method: "GET",
			url: "/admin",
		});

		expect(configuredRoute.statusCode).toBe(200);
		expect(devAlias.statusCode).toBe(200);
		expect(configuredRoute.body).toContain("QingYan Admin");
		expect(devAlias.body).toContain("QingYan Admin");
	});

	it("does not serve /admin alias outside dev mode", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.admin.console.path = "/hidden-admin";
			},
		});
		cleanups.push(fixture.cleanup);

		const configuredRoute = await fixture.app.inject({
			method: "GET",
			url: "/hidden-admin",
		});
		const defaultRoute = await fixture.app.inject({
			method: "GET",
			url: "/admin",
		});

		expect(configuredRoute.statusCode).toBe(200);
		expect(defaultRoute.statusCode).toBe(404);
	});
});
