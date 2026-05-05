import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { envMappings } from "../src/config/env-mapping";
import { loadConfig } from "../src/config/load-config";
import { configSchema } from "../src/config/types";

function createStartupConfig() {
	return {
		server: {
			host: "0.0.0.0",
			port: 4401,
			publicBaseUrl: "http://localhost:4401",
			trustProxy: false,
		},
		database: {
			client: "sqlite",
			sqlite: {
				file: "./data/qingyan.db",
			},
		},
		admin: {
			session: {
				cookieName: "qingyan_admin",
				ttlMinutes: 1440,
				sameSite: "lax",
				secure: false,
			},
		},
		security: {
			requestIdHeader: "x-request-id",
			globalFloodGuard: {
				enabled: false,
				windowSec: 10,
				maxRequests: 120,
			},
			publicOriginGuard: {
				enabled: true,
				allowMissingOrigin: false,
			},
			rateLimit: {
				adminLogin: {
					windowSec: 600,
					maxFailures: 5,
				},
				commentCreate: {
					windowSec: 300,
					maxRequests: 5,
				},
				commentVote: {
					windowSec: 300,
					maxRequests: 15,
				},
				captchaVerify: {
					windowSec: 300,
					maxFailures: 8,
				},
				pageLike: {
					windowSec: 300,
					maxRequests: 10,
				},
			},
		},
	};
}

describe("configSchema", () => {
	it("accepts startup-only configuration", () => {
		const parsed = configSchema.parse(createStartupConfig());

		expect(parsed.server.port).toBe(4401);
		expect("sites" in parsed).toBe(false);
		expect("captcha" in parsed).toBe(false);
		expect("logging" in parsed).toBe(false);
		expect("mail" in parsed).toBe(false);
	});

	it("rejects old DB-owned top-level configuration fields", () => {
		for (const key of ["sites", "captcha", "logging", "mail"] as const) {
			expect(() =>
				configSchema.parse({
					...createStartupConfig(),
					[key]: {},
				}),
			).toThrow();
		}
	});

	it("exposes startup and system-settings seed env mapping metadata", () => {
		expect(envMappings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "server.port",
					envName: "QINGYAN_SERVER_PORT",
					category: "startup",
					restartRequired: true,
				}),
				expect.objectContaining({
					path: "database.sqlite.file",
					envName: "QINGYAN_SQLITE_FILE",
					category: "startup",
					restartRequired: true,
				}),
				expect.objectContaining({
					path: "mail.smtp.password",
					envName: "QINGYAN_SMTP_PASSWORD",
					category: "system_settings_seed",
					secret: true,
					readable: false,
				}),
			]),
		);
	});

	it("applies whitelisted startup environment overrides while loading", async () => {
		const directory = mkdtempSync(path.join(tmpdir(), "qingyan-config-"));
		const configPath = path.join(directory, "qingyan.yml");
		writeFileSync(
			configPath,
			[
				"server:",
				"  host: 0.0.0.0",
				"  port: 4401",
				"  publicBaseUrl: http://localhost:4401",
				"  trustProxy: false",
				"database:",
				"  client: sqlite",
				"  sqlite:",
				"    file: ./data/qingyan.db",
				"admin:",
				"  session:",
				"    cookieName: qingyan_admin",
				"    ttlMinutes: 1440",
				"    sameSite: lax",
				"    secure: false",
				"security:",
				"  requestIdHeader: x-request-id",
				"  globalFloodGuard:",
				"    enabled: false",
				"    windowSec: 10",
				"    maxRequests: 120",
				"  publicOriginGuard:",
				"    enabled: true",
				"    allowMissingOrigin: false",
				"  rateLimit:",
				"    adminLogin:",
				"      windowSec: 600",
				"      maxFailures: 5",
				"    commentCreate:",
				"      windowSec: 300",
				"      maxRequests: 5",
				"    commentVote:",
				"      windowSec: 300",
				"      maxRequests: 15",
				"    captchaVerify:",
				"      windowSec: 300",
				"      maxFailures: 8",
				"    pageLike:",
				"      windowSec: 300",
				"      maxRequests: 10",
				"",
			].join("\n"),
			"utf-8",
		);

		try {
			const config = await loadConfig(configPath, {
				QINGYAN_SERVER_PORT: "5501",
				QINGYAN_SQLITE_FILE: "./data/env.db",
			});

			expect(config.server.port).toBe(5501);
			expect(config.database.sqlite.file).toBe("./data/env.db");
			expect("sites" in config).toBe(false);
			expect("captcha" in config).toBe(false);
			expect("mail" in config).toBe(false);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
