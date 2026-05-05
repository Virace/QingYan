import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import { buildApp } from "../../src/app";
import { resolveRuntimeOptions } from "../../src/config/runtime-options";
import type { AppConfig, SiteConfig } from "../../src/config/types";
import { createDatabaseClients } from "../../src/db/client";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { createSiteRegistry } from "../../src/modules/shared/site-registry";

function createTempWorkspace() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-"));
	const databaseFile = path.join(directory, "qingyan.db");
	const logsDirectory = path.join(directory, "logs");

	return {
		directory,
		databaseFile,
		logsDirectory,
		cleanup() {
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

export function applyInitialMigration(databaseFile: string): void {
	const sqlite = new Database(databaseFile);
	const migrationDirectory = path.resolve(process.cwd(), "drizzle");
	const migrationFiles = readdirSync(migrationDirectory)
		.filter((fileName) => fileName.endsWith(".sql"))
		.sort();

	for (const fileName of migrationFiles) {
		const sql = readFileSync(path.join(migrationDirectory, fileName), "utf-8");
		sqlite.exec(sql);
	}

	sqlite.close();
}

async function seedTestSite(
	databaseFile: string,
	site: Pick<SiteConfig, "siteKey" | "name" | "allowedOrigins">,
): Promise<void> {
	const { db, sqlite } = createDatabaseClients(databaseFile);
	try {
		await createSiteRegistry().seedSiteFromTemplate(db, site);
	} finally {
		sqlite.close();
	}
}

export function createTestConfig(
	databaseFile: string,
	logsDirectory = "./logs",
): AppConfig {
	return {
		server: {
			host: "127.0.0.1",
			port: 4401,
			publicBaseUrl: "http://localhost:4401",
			trustProxy: false,
		},
		database: {
			client: "sqlite",
			sqlite: {
				file: databaseFile,
			},
		},
		admin: {
			console: {
				path: "/admin",
			},
			auth: {
				username: "admin",
				passwordHash: createPasswordHash("replace-me"),
			},
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
				allowMissingOrigin: true,
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
		captcha: {
			provider: "image",
			image: {
				width: 160,
				height: 60,
				ttlSec: 600,
			},
		},
		logging: {
			directory: logsDirectory,
			defaults: {
				level: "info",
				retentionDays: 7,
			},
		},
		mail: {
			enabled: false,
			smtp: {
				host: "smtp.example.com",
				port: 465,
				secure: true,
				username: "notify@example.com",
				password: "secret",
				from: "notify@example.com",
			},
		},
		sites: [
			{
				siteKey: "fangyuan",
				name: "FangYuan",
				allowedOrigins: ["http://localhost:4321"],
				defaults: {
					comments: {
						enabled: true,
						defaultStatus: "pending",
						maxDepth: 3,
						rootLimit: 20,
						identity: {
							require: ["nickname", "email"],
						},
						captcha: {
							mode: "threshold",
							thresholdWindowSec: 60,
							thresholdMaxActions: 3,
						},
						abuseGuard: {
							enabled: true,
							windowSec: 600,
							maxWriteActions: 100,
							autoBlacklist: {
								enabled: true,
								scope: "post",
								ttlSec: 1800,
							},
						},
						metadata: {
							collectIp: true,
							collectUserAgent: true,
							ipRegion: {
								enabled: false,
								cachePolicy: "vectorIndex",
								precision: "province",
								autoUpdate: {
									enabled: false,
									schedule: "monthly",
								},
								ipv4: {
									dbPath: "./data/ip2region_v4.xdb",
									sources: [
										"https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb",
										"https://gitee.com/lionsoul/ip2region/raw/master/data/ip2region_v4.xdb",
									],
								},
								ipv6: {
									dbPath: "./data/ip2region_v6.xdb",
									sources: [
										"https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v6.xdb",
										"https://gitee.com/lionsoul/ip2region/raw/master/data/ip2region_v6.xdb",
									],
								},
							},
							device: {
								enabled: true,
								display: {
									enabled: false,
								},
							},
						},
						allowWebsite: true,
					},
					pageFeedback: {
						allowLike: true,
					},
					notifications: {
						emailEnabled: false,
					},
				},
			},
		],
	};
}

export async function createTestApp(options?: {
	devMode?: boolean;
	devAdminToken?: string;
	seedSite?: Pick<SiteConfig, "siteKey" | "name" | "allowedOrigins"> | false;
	mutateConfig?: (config: AppConfig) => void;
}) {
	const workspace = createTempWorkspace();
	applyInitialMigration(workspace.databaseFile);

	const baseConfig = createTestConfig(
		workspace.databaseFile,
		workspace.logsDirectory,
	);
	options?.mutateConfig?.(baseConfig);
	if (!options?.devMode) {
		const [defaultSite] = baseConfig.sites;
		const site =
			options?.seedSite === false
				? undefined
				: (options?.seedSite ?? defaultSite);
		if (!site) {
			throw new Error("Test fixture requires a default site seed.");
		}
		await seedTestSite(workspace.databaseFile, site);
	}
	const resolved = resolveRuntimeOptions(baseConfig, {
		QINGYAN_DEV_MODE: options?.devMode ? "true" : "false",
		QINGYAN_DEV_ADMIN_TOKEN: options?.devAdminToken,
		QINGYAN_DEV_ALLOWED_ORIGIN: "http://localhost:4321",
	});
	const app = await buildApp(resolved.config, resolved.runtimeOptions);

	return {
		app,
		databaseFile: workspace.databaseFile,
		logsDirectory: workspace.logsDirectory,
		runtimeOptions: resolved.runtimeOptions,
		async cleanup() {
			await app.close();
			workspace.cleanup();
		},
	};
}
