import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

import { buildApp } from "../../src/app";
import { resolveRuntimeOptions } from "../../src/config/runtime-options";
import type { AppConfig } from "../../src/config/types";
import { createDatabaseClients } from "../../src/db/client";
import { applyDatabaseMigrations } from "../../src/db/migrations";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import type { AdminProfileEmailSender } from "../../src/modules/admin/profile-service";
import type { CommentMetadataResolver } from "../../src/modules/comments/metadata/resolver";
import type { EmailSender } from "../../src/modules/notifications/channels/email-channel";
import type { ServiceControlController } from "../../src/modules/service-control/systemd-service";
import {
	createSiteRegistry,
	type SiteSeed,
} from "../../src/modules/shared/site-registry";

export interface TestWorkspace {
	directory: string;
	databaseFile: string;
	databaseUrl: string;
	configPath: string;
	logsDirectory: string;
	cleanup: () => Promise<void>;
}

function testServerUrl(): URL {
	const value = process.env.QINGYAN_TEST_DATABASE_URL;
	if (!value)
		throw new Error(
			"QINGYAN_TEST_DATABASE_URL must point to an isolated PostgreSQL test server.",
		);
	return new URL(value);
}

export function createTestWorkspace(prefix = "qingyan-"): TestWorkspace {
	const root = path.resolve(
		process.cwd(),
		".temp/postgresql-migration/testing/workspaces",
	);
	mkdirSync(root, { recursive: true });
	const directory = mkdtempSync(path.join(root, prefix));
	const databaseName = `qingyan_test_${randomUUID().replaceAll("-", "")}`;
	const databaseUrl = testServerUrl();
	databaseUrl.pathname = `/${databaseName}`;
	return {
		directory,
		databaseFile: path.join(directory, "source.sqlite"),
		databaseUrl: databaseUrl.toString(),
		configPath: path.join(directory, "config", "qingyan.yml"),
		logsDirectory: path.join(directory, "logs"),
		async cleanup() {
			const pool = new Pool({
				connectionString: testServerUrl().toString(),
				max: 1,
			});
			try {
				await pool.query(
					`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
				);
			} finally {
				await pool.end();
			}
		},
	};
}

export async function applyInitialMigration(
	databaseUrl: string,
): Promise<void> {
	await applyCurrentMigrations(databaseUrl);
}

export async function ensureTestDatabase(databaseUrl: string): Promise<void> {
	const name = new URL(databaseUrl).pathname.slice(1);
	if (!/^qingyan_test_[a-f0-9]{32}$/.test(name))
		throw new Error("Fixture database name is not owned by this test.");
	const admin = new Pool({
		connectionString: testServerUrl().toString(),
		max: 1,
	});
	try {
		const exists = await admin.query(
			"SELECT 1 FROM pg_database WHERE datname = $1",
			[name],
		);
		if (exists.rowCount === 0)
			await admin.query(
				`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`,
			);
	} finally {
		await admin.end();
	}
}

export async function applyCurrentMigrations(
	databaseUrl: string,
): Promise<void> {
	await ensureTestDatabase(databaseUrl);
	const clients = createDatabaseClients(databaseUrl, { pool: { max: 2 } });
	try {
		await applyDatabaseMigrations(clients.pool);
	} finally {
		await clients.close();
	}
}

async function seedTestSite(
	databaseUrl: string,
	site: SiteSeed,
): Promise<void> {
	const clients = createDatabaseClients(databaseUrl, { pool: { max: 2 } });
	try {
		await createSiteRegistry().seedSiteFromTemplate(clients.db, site);
	} finally {
		await clients.close();
	}
}

export const defaultTestSite: SiteSeed = {
	siteKey: "fangyuan",
	name: "FangYuan",
	allowedOrigins: ["http://localhost:4321"],
};

export function createTestConfig(
	databaseUrl: string,
	logsDirectory = "./logs",
): AppConfig {
	return {
		server: {
			host: "127.0.0.1",
			port: 4401,
			publicBaseUrl: "http://localhost:4401",
			publicPath: "/qingyan",
			trustProxy: false,
		},
		database: {
			url: databaseUrl,
			pool: { max: 2, connectionTimeoutMs: 5000, idleTimeoutMs: 30000 },
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
				ttlMinutes: 4320,
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
			adminOriginGuard: {
				enabled: true,
				allowMissingOrigin: false,
				allowedOrigins: [],
			},
			rateLimit: {
				adminLogin: {
					windowSec: 600,
					maxFailures: 5,
					autoBlacklistSec: 1800,
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
		logging: {
			directory: logsDirectory,
		},
	};
}

export async function createTestApp(options?: {
	devMode?: boolean;
	devAdminToken?: string;
	adminDistDirectory?: string;
	commentMetadataResolver?: CommentMetadataResolver;
	seedSite?: SiteSeed | false;
	mutateConfig?: (config: AppConfig) => void;
	pageSourceFetchText?: (
		url: string,
		options: {
			allowedOrigins: string[];
			timeoutMs?: number;
			maxBytes?: number;
		},
	) => Promise<string>;
	pageTitleFetchHtml?: (
		url: string,
		options: { allowedOrigins: string[]; timeoutMs: number; maxBytes: number },
	) => Promise<{ status: number; text: string }>;
	serviceControl?: ServiceControlController;
	emailSender?: EmailSender;
	adminProfileEmailSender?: AdminProfileEmailSender;
}) {
	const workspace = createTestWorkspace();
	await applyCurrentMigrations(workspace.databaseUrl);

	const baseConfig = createTestConfig(
		workspace.databaseUrl,
		workspace.logsDirectory,
	);
	options?.mutateConfig?.(baseConfig);
	if (!options?.devMode) {
		const site =
			options?.seedSite === false
				? undefined
				: (options?.seedSite ?? defaultTestSite);
		if (!site) {
			throw new Error("Test fixture requires a default site seed.");
		}
		await seedTestSite(workspace.databaseUrl, site);
	}
	const resolved = resolveRuntimeOptions(baseConfig, {
		QINGYAN_DEV_MODE: options?.devMode ? "true" : "false",
		QINGYAN_DEV_ADMIN_TOKEN: options?.devAdminToken,
		QINGYAN_DEV_ALLOWED_ORIGIN: "http://localhost:4321",
	});
	const app = await buildApp(resolved.config, resolved.runtimeOptions, {
		adminDistDirectory: options?.adminDistDirectory,
		commentMetadataResolver: options?.commentMetadataResolver,
		pageSourceFetchText: options?.pageSourceFetchText,
		pageTitleFetchHtml: options?.pageTitleFetchHtml,
		serviceControl: options?.serviceControl,
		emailSender:
			options?.emailSender ??
			(async () => ({ providerMessageId: "test-smtp-message" })),
		adminProfileEmailSender: options?.adminProfileEmailSender,
		startNotificationRuntime: false,
	});

	return {
		app,
		databaseUrl: workspace.databaseUrl,
		pool: app.databasePool,
		logsDirectory: workspace.logsDirectory,
		runtimeOptions: resolved.runtimeOptions,
		async cleanup() {
			await app.close();
			await workspace.cleanup();
		},
	};
}
