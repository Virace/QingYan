import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config/load-config";
import { buildInstallApp } from "../../src/modules/install/install-app";
import { resolveInstallState } from "../../src/modules/install/state";
import {
	createLifecycleFixture,
	installPayload,
} from "../support/lifecycle-fixture";

const installPath = "/qingyan/admin/install";
describe("PostgreSQL installation", () => {
	it("serves only installation and health routes before bootstrap", async () => {
		const fixture = await createLifecycleFixture({ empty: true });
		const app = buildInstallApp({ minimalConfig: fixture.minimalConfig });
		try {
			expect((await app.inject(installPath)).statusCode).toBe(200);
			expect((await app.inject("/qingyan/admin")).headers.location).toBe(
				installPath,
			);
			expect((await app.inject("/qingyan/healthz")).json()).toMatchObject({
				mode: "install",
			});
			expect((await app.inject("/qingyan/api/admin/session")).statusCode).toBe(
				404,
			);
			expect((await app.inject("/qingyan/api/comments")).statusCode).toBe(404);
		} finally {
			await app.close();
			await fixture.cleanup();
		}
	});
	it("previews an empty target without configuration or database writes and hides database credentials", async () => {
		const fixture = await createLifecycleFixture({ empty: true });
		const app = buildInstallApp({ minimalConfig: fixture.minimalConfig });
		try {
			const response = await app.inject({
				method: "POST",
				url: `${installPath}/plan`,
				payload: installPayload(fixture.databaseUrl),
			});
			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				database: { url: "[redacted]" },
				admin: { consolePath: "/admin", username: "admin" },
			});
			expect(response.body).not.toContain(
				new URL(fixture.databaseUrl).password,
			);
			expect(existsSync(fixture.configPath)).toBe(false);
			expect(
				(
					await fixture.pool.query(
						"SELECT tablename FROM pg_tables WHERE schemaname='public'",
					)
				).rows,
			).toEqual([]);
		} finally {
			await app.close();
			await fixture.cleanup();
		}
	});
	it.each([
		undefined,
		"invalid",
	])("rejects missing or invalid installation token %s", async (token) => {
		const fixture = await createLifecycleFixture({ empty: true });
		const app = buildInstallApp({ minimalConfig: fixture.minimalConfig });
		try {
			const response = await app.inject({
				method: "POST",
				url: installPath,
				payload: { ...installPayload(fixture.databaseUrl), token },
			});
			expect(response.statusCode).toBe(403);
			expect(response.json().error.code).toBe("INSTALL_TOKEN_INVALID");
			expect(existsSync(fixture.configPath)).toBe(false);
		} finally {
			await app.close();
			await fixture.cleanup();
		}
	});
	it.each([
		"manual",
		"exit_for_supervisor",
		"reload_in_process",
	] as const)("initializes credentials, site, settings and saved config with %s transition", async (transitionMode) => {
		const fixture = await createLifecycleFixture({ empty: true });
		const scheduleTransition = vi.fn();
		const app = buildInstallApp({
			minimalConfig: { ...fixture.minimalConfig, transitionMode },
			scheduleTransition,
		});
		try {
			const response = await app.inject({
				method: "POST",
				url: installPath,
				payload: installPayload(fixture.databaseUrl),
			});
			expect(response.statusCode).toBe(201);
			expect(response.json()).toMatchObject({
				username: "admin",
				initialPassword: "adminadmin",
				transition: { mode: transitionMode },
			});
			expect(scheduleTransition).toHaveBeenCalledTimes(
				transitionMode === "manual" ? 0 : 1,
			);
			const config = await loadConfig(fixture.configPath, {});
			expect(config.database.url).toBe(fixture.databaseUrl);
			const users = await fixture.pool.query(
				"SELECT username,password_hash,is_initial_admin FROM admin_users",
			);
			expect(users.rows).toHaveLength(1);
			expect(users.rows[0]).toMatchObject({
				username: "admin",
				is_initial_admin: true,
			});
			expect(users.rows[0].password_hash).not.toBe("adminadmin");
			expect(
				(await fixture.pool.query("SELECT site_key FROM sites")).rows,
			).toEqual([{ site_key: "default" }]);
			expect(
				Number(
					(
						await fixture.pool.query(
							"SELECT count(*) AS count FROM system_settings",
						)
					).rows[0].count,
				),
			).toBeGreaterThan(0);
			expect(
				(await resolveInstallState(fixture.minimalConfig, {})).installed,
			).toBe(true);
			expect((await app.inject(installPath)).statusCode).toBe(410);
		} finally {
			await app.close();
			await fixture.cleanup();
		}
	});
	it("applies environment database URL and secret seeds without exposing them", async () => {
		const fixture = await createLifecycleFixture({ empty: true });
		const environment = {
			QINGYAN_DATABASE_URL: fixture.databaseUrl,
			QINGYAN_SMTP_PASSWORD: "install-seed-secret",
		};
		const app = buildInstallApp({
			minimalConfig: fixture.minimalConfig,
			environment,
		});
		try {
			const payload = installPayload(
				"postgresql://unused:unused@127.0.0.1:1/unused",
			);
			const plan = await app.inject({
				method: "POST",
				url: `${installPath}/plan`,
				payload,
			});
			expect(plan.statusCode).toBe(200);
			expect(plan.body).not.toContain("install-seed-secret");
			expect(plan.json().env).toContainEqual(
				expect.objectContaining({ path: "database.url", secret: true }),
			);
			const response = await app.inject({
				method: "POST",
				url: installPath,
				payload,
			});
			expect(response.statusCode).toBe(201);
			expect(response.body).not.toContain("install-seed-secret");
			expect((await loadConfig(fixture.configPath, {})).database.url).toBe(
				fixture.databaseUrl,
			);
			expect(
				(
					await fixture.pool.query(
						"SELECT value_json FROM system_settings WHERE category='mail' AND key='smtp.password'",
					)
				).rows[0].value_json,
			).toBe(JSON.stringify("install-seed-secret"));
		} finally {
			await app.close();
			await fixture.cleanup();
		}
	});
	it("rejects a nonempty target without changing it", async () => {
		const fixture = await createLifecycleFixture({ empty: true });
		await fixture.pool.query("CREATE TABLE existing(id integer)");
		const app = buildInstallApp({ minimalConfig: fixture.minimalConfig });
		try {
			const response = await app.inject({
				method: "POST",
				url: `${installPath}/plan`,
				payload: installPayload(fixture.databaseUrl),
			});
			expect(response.statusCode).toBe(409);
			expect(response.json().error.code).toBe("DATABASE_TARGET_NOT_EMPTY");
			expect(
				(
					await fixture.pool.query(
						"SELECT tablename FROM pg_tables WHERE schemaname='public'",
					)
				).rows,
			).toEqual([{ tablename: "existing" }]);
			expect(existsSync(fixture.configPath)).toBe(false);
		} finally {
			await app.close();
			await fixture.cleanup();
		}
	});
	it("preserves generated plan identity for confirmed installation", async () => {
		const fixture = await createLifecycleFixture({ empty: true });
		const app = buildInstallApp({ minimalConfig: fixture.minimalConfig });
		try {
			const payload = { ...installPayload(fixture.databaseUrl), admin: {} };
			const response = await app.inject({
				method: "POST",
				url: `${installPath}/plan`,
				payload,
			});
			expect(response.statusCode).toBe(200);
			const plan = response.json();
			const applied = await app.inject({
				method: "POST",
				url: installPath,
				payload: {
					...plan.applyPayload,
					database: payload.database,
					token: "install-token",
				},
			});
			expect(applied.statusCode).toBe(201);
			expect(applied.json().username).toBe(plan.admin.username);
			expect(applied.json().adminUrl).toContain(plan.admin.consolePath);
			expect(applied.json().initialPassword.length).toBeGreaterThanOrEqual(8);
		} finally {
			await app.close();
			await fixture.cleanup();
		}
	});
	it("validates verified-author settings and saves engagement choices", async () => {
		const fixture = await createLifecycleFixture({ empty: true });
		const app = buildInstallApp({ minimalConfig: fixture.minimalConfig });
		try {
			const payload = {
				...installPayload(fixture.databaseUrl),
				siteSettings: {
					comments: {
						verifiedAuthor: {
							enabled: true,
							displayName: "Editor",
							email: "",
							website: "",
							badgeLabel: "Editor",
						},
					},
					engagement: {
						visitors: { enabled: false },
						pageViews: { enabled: true },
						pageLikes: { enabled: false },
						commentVotes: { enabled: false },
					},
				},
			};
			expect(
				(
					await app.inject({
						method: "POST",
						url: `${installPath}/plan`,
						payload,
					})
				).statusCode,
			).toBe(400);
			payload.siteSettings.comments.verifiedAuthor.email = "editor@example.com";
			const response = await app.inject({
				method: "POST",
				url: installPath,
				payload,
			});
			expect(response.statusCode).toBe(201);
			const setting = (
				await fixture.pool.query(
					"SELECT verified_author_json,engagement_json FROM site_settings",
				)
			).rows[0];
			expect(JSON.parse(setting.verified_author_json)).toMatchObject({
				enabled: true,
				email: "editor@example.com",
			});
			expect(JSON.parse(setting.engagement_json)).toMatchObject({
				visitors: { enabled: false },
				pageLikes: { enabled: false },
			});
		} finally {
			await app.close();
			await fixture.cleanup();
		}
	});
});
