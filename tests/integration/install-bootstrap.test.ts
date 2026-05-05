import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config/load-config";
import { createDatabaseClients } from "../../src/db/client";
import {
	adminBootstrapState,
	siteSettings,
	sites,
	systemSettings,
} from "../../src/db/schema";
import { buildInstallApp } from "../../src/modules/install/install-app";
import {
	resolveMinimalInstallConfig,
	type MinimalInstallConfig,
} from "../../src/modules/install/minimal-config";
import { resolveInstallState } from "../../src/modules/install/state";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

function createWorkspace() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-install-"));
	const configPath = path.join(directory, "config", "qingyan.yml");
	const databaseFile = path.join(directory, "data", "qingyan.db");
	cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
	return {
		directory,
		configPath,
		databaseFile,
	};
}

function createMinimalConfig(configPath: string): MinimalInstallConfig {
	return {
		configPath,
		host: "127.0.0.1",
		port: 4401,
		token: "install-token",
		disabled: false,
	};
}

function installPayload(databaseFile: string, token = "install-token") {
	return {
		token,
		server: {
			host: "127.0.0.1",
			port: 4401,
			publicBaseUrl: "http://localhost:4401",
			trustProxy: false,
		},
		database: {
			sqliteFile: databaseFile,
		},
		admin: {
			consolePath: "/admin",
			username: "admin",
			password: "adminadmin",
		},
		site: {
			siteKey: "default",
			name: "Default",
			allowedOrigins: ["http://localhost:4321"],
		},
	};
}

function installFormPayload(databaseFile: string) {
	const payload = installPayload(databaseFile);
	return {
		server: payload.server,
		database: payload.database,
		admin: payload.admin,
		site: payload.site,
	};
}

async function getInstallCookie(app: ReturnType<typeof buildInstallApp>) {
	const installPage = await app.inject({
		method: "GET",
		url: "/admin/install",
	});
	return installPage.cookies.find(
		(cookie) => cookie.name === "qingyan_install",
	);
}

function installGeneratedAdminPayload(databaseFile: string) {
	const payload = installFormPayload(databaseFile);
	return {
		...payload,
		admin: {},
	};
}

describe("install bootstrap", () => {
	it("serves install page when config is missing", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const response = await app.inject({
			method: "GET",
			url: "/admin/install",
		});

		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("QingYan Install");
		expect(response.body).toContain("生成安装计划");
		expect(response.body).toContain("确认安装");
		expect(response.body).toContain("后台入口");
		expect(response.body).toContain("系统设置");
		expect(response.body).toContain('name="adminConsolePath"');
		expect(response.body).not.toContain("Use <code>POST");
		expect(response.body).not.toContain("install-token");
	});

	it("redirects the default admin UI entry to install before bootstrap", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const admin = await app.inject({
			method: "GET",
			url: "/admin",
		});
		expect(admin.statusCode).toBe(302);
		expect(admin.headers.location).toBe("/admin/install");

		const adminSlash = await app.inject({
			method: "GET",
			url: "/admin/",
		});
		expect(adminSlash.statusCode).toBe(302);
		expect(adminSlash.headers.location).toBe("/admin/install");
	});

	it("exposes only the install mini-app route set before bootstrap", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const allowed = [
			["GET", "/admin"],
			["GET", "/admin/"],
			["GET", "/admin/install"],
			["POST", "/admin/install/plan"],
			["POST", "/admin/install"],
		] as const;

		for (const [method, url] of allowed) {
			const response = await app.inject({
				method,
				url,
				payload:
					method === "POST"
						? installFormPayload(workspace.databaseFile)
						: undefined,
			});
			expect([200, 302, 403]).toContain(response.statusCode);
		}

		const blocked = [
			["GET", "/install"],
			["GET", "/api/install/state"],
			["GET", "/api/admin/install/state"],
			["GET", "/api/admin/session/me"],
			["GET", "/api/comments/bootstrap?siteKey=default&pageKey=home"],
		] as const;

		for (const [method, url] of blocked) {
			const response = await app.inject({ method, url });
			expect(response.statusCode).toBe(404);
		}
	});

	it("builds an install plan without writing config or database", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		const installPage = await app.inject({
			method: "GET",
			url: "/admin/install",
		});
		const installCookie = installPage.cookies.find(
			(cookie) => cookie.name === "qingyan_install",
		);

		const response = await app.inject({
			method: "POST",
			url: "/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			config: {
				path: workspace.configPath,
				writes: expect.arrayContaining(["server", "database"]),
			},
			database: {
				sqliteFile: workspace.databaseFile,
				seeds: expect.arrayContaining(["site_settings", "system_settings"]),
			},
			admin: {
				consolePath: "/admin",
				username: "admin",
				passwordGenerated: false,
			},
			systemSettings: expect.arrayContaining([
				expect.objectContaining({ category: "logging", key: "level" }),
				expect.objectContaining({
					category: "captcha",
					key: "image.ttlSec",
					source: "default",
					valuePreview: 600,
				}),
				expect.objectContaining({ category: "mail", key: "enabled" }),
				expect.objectContaining({ category: "ipRegion", key: "enabled" }),
			]),
		});
		expect(existsSync(workspace.configPath)).toBe(false);
		expect(existsSync(workspace.databaseFile)).toBe(false);
	});

	it("reports env-managed fields in the install plan without leaking secret values", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
			environment: {
				QINGYAN_SERVER_HOST: "0.0.0.0",
				QINGYAN_SMTP_PASSWORD: "super-secret-password",
			},
		});
		cleanups.push(() => app.close());

		const installPage = await app.inject({
			method: "GET",
			url: "/admin/install",
		});
		const installCookie = installPage.cookies.find(
			(cookie) => cookie.name === "qingyan_install",
		);

		const response = await app.inject({
			method: "POST",
			url: "/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			env: expect.arrayContaining([
				{
					path: "server.host",
					envName: "QINGYAN_SERVER_HOST",
					locked: true,
					secret: false,
					source: "env",
					valuePreview: "0.0.0.0",
				},
				{
					path: "mail.smtp.password",
					envName: "QINGYAN_SMTP_PASSWORD",
					locked: true,
					secret: true,
					source: "env",
					valuePreview: "configured",
				},
			]),
			systemSettings: expect.arrayContaining([
				expect.objectContaining({
					category: "mail",
					key: "smtp.password",
					source: "environment",
					envName: "QINGYAN_SMTP_PASSWORD",
					secret: true,
					valuePreview: "configured",
				}),
			]),
		});
		expect(response.body).not.toContain("super-secret-password");
	});

	it("applies startup env overrides consistently between plan and install", async () => {
		const workspace = createWorkspace();
		const envDatabaseFile = path.join(workspace.directory, "env", "qingyan.db");
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
			environment: {
				QINGYAN_SERVER_HOST: "0.0.0.0",
				QINGYAN_SERVER_PORT: "5502",
				QINGYAN_PUBLIC_BASE_URL: "https://comments.example.test",
				QINGYAN_TRUST_PROXY: "true",
				QINGYAN_SQLITE_FILE: envDatabaseFile,
				QINGYAN_ADMIN_SESSION_COOKIE_NAME: "qy_admin",
				QINGYAN_ADMIN_SESSION_TTL_MINUTES: "60",
				QINGYAN_ADMIN_SESSION_SAME_SITE: "strict",
				QINGYAN_ADMIN_SESSION_SECURE: "true",
			},
		});
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const response = await app.inject({
			method: "POST",
			url: "/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(200);
		const plan = response.json();
		expect(plan.database.sqliteFile).toBe(envDatabaseFile);
		expect(plan.env).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "server.host",
					envName: "QINGYAN_SERVER_HOST",
					valuePreview: "0.0.0.0",
				}),
				expect.objectContaining({
					path: "database.sqlite.file",
					envName: "QINGYAN_SQLITE_FILE",
					valuePreview: envDatabaseFile,
				}),
				expect.objectContaining({
					path: "admin.session.cookieName",
					envName: "QINGYAN_ADMIN_SESSION_COOKIE_NAME",
					valuePreview: "qy_admin",
				}),
			]),
		);

		const apply = await app.inject({
			method: "POST",
			url: "/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: plan.applyPayload,
		});

		expect(apply.statusCode).toBe(201);
		expect(apply.json()).toMatchObject({
			adminUrl: "https://comments.example.test/admin",
			databasePath: path.resolve(process.cwd(), envDatabaseFile),
		});
		const config = await loadConfig(workspace.configPath, {});
		expect(config.server).toMatchObject({
			host: "0.0.0.0",
			port: 5502,
			publicBaseUrl: "https://comments.example.test",
			trustProxy: true,
		});
		expect(config.database.sqlite.file).toBe(envDatabaseFile);
		expect(config.admin.session).toMatchObject({
			cookieName: "qy_admin",
			ttlMinutes: 60,
			sameSite: "strict",
			secure: true,
		});
		expect(existsSync(envDatabaseFile)).toBe(true);
	});

	it("rejects missing or invalid install tokens", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const state = await app.inject({
			method: "POST",
			url: "/admin/install",
			payload: installFormPayload(workspace.databaseFile),
		});
		expect(state.statusCode).toBe(403);
		expect(state.json()).toMatchObject({
			error: {
				code: "INSTALL_TOKEN_INVALID",
			},
		});

		const apply = await app.inject({
			method: "POST",
			url: "/admin/install",
			payload: installPayload(workspace.databaseFile, "bad-token"),
		});
		expect(apply.statusCode).toBe(403);
		expect(apply.json()).toMatchObject({
			error: {
				code: "INSTALL_TOKEN_INVALID",
			},
		});
	});

	it("writes startup config and seeds the SQLite database", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		expect(installCookie?.httpOnly).toBe(true);

		const response = await app.inject({
			method: "POST",
			url: "/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			adminUrl: "http://localhost:4401/admin",
			username: "admin",
			initialPassword: "adminadmin",
			configPath: workspace.configPath,
			databasePath: path.resolve(process.cwd(), workspace.databaseFile),
			systemSettings: expect.arrayContaining([
				expect.objectContaining({ category: "logging", key: "level" }),
				expect.objectContaining({ category: "captcha", key: "provider" }),
				expect.objectContaining({
					category: "captcha",
					key: "image.ttlSec",
					valuePreview: 600,
				}),
			]),
			restartRequired: true,
		});

		const config = await loadConfig(workspace.configPath, {});
		expect(config.database.sqlite.file).toBe(workspace.databaseFile);
		expect(config.server.publicBaseUrl).toBe("http://localhost:4401");

		const { db, sqlite } = createDatabaseClients(workspace.databaseFile);
		try {
			const [bootstrap] = await db.select().from(adminBootstrapState);
			expect(bootstrap).toMatchObject({
				consolePath: "/admin",
				username: "admin",
			});
			const [site] = await db
				.select()
				.from(sites)
				.where(eq(sites.siteKey, "default"));
			expect(site).toMatchObject({
				name: "Default",
			});
			const [settings] = await db
				.select()
				.from(siteSettings)
				.where(eq(siteSettings.siteId, site?.id ?? 0));
			expect(settings).toMatchObject({
				commentsEnabled: true,
				rootLimit: 20,
			});
			const systemSettingRows = await db.select().from(systemSettings);
			expect(systemSettingRows).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						category: "logging",
						key: "level",
						valueJson: '"info"',
					}),
					expect.objectContaining({
						category: "logging",
						key: "retentionDays",
						valueJson: "7",
					}),
					expect.objectContaining({ category: "captcha", key: "provider" }),
					expect.objectContaining({
						category: "captcha",
						key: "image.ttlSec",
					}),
					expect.objectContaining({ category: "mail", key: "enabled" }),
					expect.objectContaining({ category: "ipRegion", key: "enabled" }),
				]),
			);
		} finally {
			sqlite.close();
		}
	});

	it("stores env-backed system setting secrets without leaking them in responses", async () => {
		const workspace = createWorkspace();
		const smtpSecret = "install-test-smtp-secret";
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
			environment: {
				QINGYAN_SMTP_PASSWORD: smtpSecret,
				QINGYAN_TURNSTILE_SECRET_KEY: "turnstile-test-secret",
			},
		});
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const plan = await app.inject({
			method: "POST",
			url: "/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(plan.statusCode).toBe(200);
		expect(plan.body).toContain("QINGYAN_SMTP_PASSWORD");
		expect(plan.body).toContain("configured");
		expect(plan.body).not.toContain(smtpSecret);

		const apply = await app.inject({
			method: "POST",
			url: "/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: plan.json().applyPayload,
		});

		expect(apply.statusCode).toBe(201);
		expect(apply.body).not.toContain(smtpSecret);
		expect(apply.json()).toMatchObject({
			systemSettings: expect.arrayContaining([
				expect.objectContaining({
					category: "mail",
					key: "smtp.password",
					source: "environment",
					envName: "QINGYAN_SMTP_PASSWORD",
					secret: true,
					valuePreview: "configured",
				}),
				expect.objectContaining({
					category: "captcha",
					key: "turnstile.secretKey",
					source: "environment",
					envName: "QINGYAN_TURNSTILE_SECRET_KEY",
					secret: true,
					valuePreview: "configured",
				}),
			]),
		});

		const { db, sqlite } = createDatabaseClients(workspace.databaseFile);
		try {
			const rows = await db.select().from(systemSettings);
			expect(rows).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						category: "mail",
						key: "smtp.password",
						valueJson: JSON.stringify(smtpSecret),
					}),
					expect.objectContaining({
						category: "captcha",
						key: "turnstile.secretKey",
						valueJson: JSON.stringify("turnstile-test-secret"),
					}),
				]),
			);
		} finally {
			sqlite.close();
		}
	});

	it("generates admin console path and password when omitted", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const response = await app.inject({
			method: "POST",
			url: "/admin/install",
			cookies: {
				qingyan_install: "install-token",
			},
			payload: installGeneratedAdminPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(201);
		const result = response.json();
		expect(result.adminUrl).toMatch(
			/^http:\/\/localhost:4401\/qy-[A-Za-z0-9]{12}$/,
		);
		expect(result.username).toBe("admin");
		expect(result.initialPassword.length).toBeGreaterThanOrEqual(18);

		const { db, sqlite } = createDatabaseClients(workspace.databaseFile);
		try {
			const [bootstrap] = await db.select().from(adminBootstrapState);
			expect(bootstrap?.consolePath).toMatch(/^\/qy-[A-Za-z0-9]{12}$/);
			expect(bootstrap?.username).toBe("admin");
		} finally {
			sqlite.close();
		}
	});

	it("uses the generated plan payload for the final install apply", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const plan = await app.inject({
			method: "POST",
			url: "/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installGeneratedAdminPayload(workspace.databaseFile),
		});

		expect(plan.statusCode).toBe(200);
		const applyPayload = plan.json().applyPayload;
		expect(applyPayload.admin.consolePath).toMatch(/^\/qy-[A-Za-z0-9]{12}$/);
		expect(applyPayload.admin.username).toBe("admin");
		expect(applyPayload.admin.password).toBeUndefined();

		const apply = await app.inject({
			method: "POST",
			url: "/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: applyPayload,
		});

		expect(apply.statusCode).toBe(201);
		expect(apply.json().username).toBe("admin");
		expect(apply.json().initialPassword.length).toBeGreaterThanOrEqual(18);
		expect(apply.json().adminUrl).toBe(
			`http://localhost:4401${applyPayload.admin.consolePath}`,
		);
	});

	it("backs up an invalid existing config before replacing it", async () => {
		const workspace = createWorkspace();
		const previousContent = "server: [invalid";
		mkdirSync(path.dirname(workspace.configPath), { recursive: true });
		writeFileSync(workspace.configPath, previousContent, "utf-8");
		const minimalConfig = createMinimalConfig(workspace.configPath);
		await expect(resolveInstallState(minimalConfig, {})).resolves.toMatchObject(
			{
				installed: false,
				reason: "config_invalid",
			},
		);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		const apply = await app.inject({
			method: "POST",
			url: "/admin/install",
			payload: installPayload(workspace.databaseFile),
		});

		expect(apply.statusCode).toBe(201);
		const result = apply.json();
		expect(result.backupPath).toMatch(/qingyan\.yml\.bak-\d{14}$/);
		expect(await readFile(result.backupPath, "utf-8")).toBe(previousContent);
		await expect(loadConfig(workspace.configPath, {})).resolves.toMatchObject({
			database: {
				sqlite: {
					file: workspace.databaseFile,
				},
			},
		});
		expect(
			readdirSync(path.dirname(workspace.configPath)).some((fileName) =>
				fileName.startsWith("qingyan.yml.bak-"),
			),
		).toBe(true);
	});

	it("resolves installed state after apply and blocks install page", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		await app.inject({
			method: "POST",
			url: "/admin/install",
			payload: installPayload(workspace.databaseFile),
		});

		await expect(resolveInstallState(minimalConfig, {})).resolves.toMatchObject(
			{
				installed: true,
			},
		);
		const response = await app.inject({
			method: "GET",
			url: "/admin/install",
		});
		expect(response.statusCode).toBe(410);

		const apply = await app.inject({
			method: "POST",
			url: "/admin/install",
			payload: installPayload(workspace.databaseFile),
		});
		expect(apply.statusCode).toBe(410);

		const plan = await app.inject({
			method: "POST",
			url: "/admin/install/plan",
			payload: installPayload(workspace.databaseFile),
		});
		expect(plan.statusCode).toBe(410);
	});

	it("resolves disabled install mode from environment", () => {
		const workspace = createWorkspace();
		const minimalConfig = resolveMinimalInstallConfig({
			QINGYAN_CONFIG_PATH: workspace.configPath,
			QINGYAN_INSTALL_DISABLED: "true",
		});

		expect(minimalConfig.disabled).toBe(true);
		expect(minimalConfig.configPath).toBe(workspace.configPath);
	});

	it("keeps install mode out of root UI and normal admin session routes", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const rootInstall = await app.inject({
			method: "GET",
			url: "/install?token=install-token",
		});
		expect(rootInstall.statusCode).toBe(404);

		const legacyApi = await app.inject({
			method: "GET",
			url: "/api/install/state?token=install-token",
		});
		expect(legacyApi.statusCode).toBe(404);

		const adminInstallApi = await app.inject({
			method: "GET",
			url: "/api/admin/install/state?token=install-token",
		});
		expect(adminInstallApi.statusCode).toBe(404);

		const adminSession = await app.inject({
			method: "GET",
			url: "/api/admin/session/me",
		});
		expect(adminSession.statusCode).toBe(404);

		const publicApi = await app.inject({
			method: "GET",
			url: "/api/comments/bootstrap?siteKey=default&pageKey=home",
		});
		expect(publicApi.statusCode).toBe(404);
	});
});
