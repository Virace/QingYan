import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseClients } from "../../src/db/client";
import { adminBootstrapState, adminUsers } from "../../src/db/schema";
import { AdminIdentityService } from "../../src/modules/admin/admin-identity-service";
import { resolveAdminBootstrap } from "../../src/modules/admin/bootstrap-service";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import {
	applyCurrentMigrations,
	createTestApp,
	createTestConfig,
	createTestWorkspace,
} from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

async function createBootstrapFixture() {
	const workspace = createTestWorkspace();
	await applyCurrentMigrations(workspace.databaseUrl);
	const clients = createDatabaseClients(workspace.databaseUrl, {
		pool: { max: 2 },
	});
	cleanups.push(async () => {
		await clients.close();
		await workspace.cleanup();
	});
	return {
		db: clients.db,
		config: createTestConfig(workspace.databaseUrl, workspace.logsDirectory),
	};
}

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
		const [user] = await fixture.app.db.select().from(adminUsers);
		expect(user?.username).toMatch(/^admin_[A-Za-z0-9]+$/);
		expect(user?.passwordHash).toMatch(/^scrypt:/);
		expect(fixture.app.adminBootstrap.generatedPassword).toBeTruthy();

		const response = await fixture.app.inject({
			method: "GET",
			url: `/qingyan${rows[0]?.consolePath ?? "/missing"}/`,
		});
		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("QingYan Admin");
	});

	it("uses fixed credentials in dev mode", async () => {
		const fixture = await createBootstrapFixture();
		fixture.config.admin.console.path = undefined;
		fixture.config.admin.auth.username = undefined;
		fixture.config.admin.auth.passwordHash = undefined;
		const bootstrap = await resolveAdminBootstrap(fixture.config, fixture.db, {
			devMode: {
				enabled: true,
				adminUsername: "admin",
				adminPassword: "admin",
			},
		});

		const rows = await fixture.db.select().from(adminBootstrapState);
		expect(rows).toHaveLength(0);
		expect(bootstrap).toMatchObject({
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
		const fixture = await createBootstrapFixture();
		fixture.config.admin.console.path = undefined;
		fixture.config.admin.auth.username = undefined;
		fixture.config.admin.auth.passwordHash = undefined;
		const passwordHash = createPasswordHash("installed-password");
		await new AdminIdentityService(fixture.db).ensureInitialAdmin({
			consolePath: "/hidden-admin",
			username: "installed-admin",
			passwordHash,
		});
		const bootstrap = await resolveAdminBootstrap(fixture.config, fixture.db, {
			devMode: {
				enabled: true,
				adminUsername: "admin",
				adminPassword: "admin",
			},
		});

		expect(bootstrap).toMatchObject({
			consolePath: "/hidden-admin",
			username: "admin",
			generatedPassword: "admin",
		});
		const [user] = await fixture.db.select().from(adminUsers);
		expect(user).toMatchObject({
			username: "installed-admin",
			passwordHash,
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
			url: "/qingyan/hidden-admin/",
		});
		const devAlias = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/admin/",
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
			url: "/qingyan/hidden-admin/",
		});
		const defaultRoute = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/admin",
		});

		expect(configuredRoute.statusCode).toBe(200);
		expect(defaultRoute.statusCode).toBe(404);
	});
});
