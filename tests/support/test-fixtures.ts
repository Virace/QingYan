import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import { buildApp } from "../../src/app";
import type { AppConfig } from "../../src/config/types";

function createTempWorkspace() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-"));
	const databaseFile = path.join(directory, "qingyan.db");

	return {
		directory,
		databaseFile,
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

export function createTestConfig(databaseFile: string): AppConfig {
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
			tokenHash: "replace-me",
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
			rateLimit: {
				adminLogin: {
					windowSec: 600,
					maxFailures: 10,
					autoBlacklistSec: 3600,
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
						requireEmail: false,
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

export async function createTestApp() {
	const workspace = createTempWorkspace();
	applyInitialMigration(workspace.databaseFile);

	const app = await buildApp(createTestConfig(workspace.databaseFile));

	return {
		app,
		databaseFile: workspace.databaseFile,
		async cleanup() {
			await app.close();
			workspace.cleanup();
		},
	};
}
