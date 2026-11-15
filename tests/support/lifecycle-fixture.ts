import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import { createDatabaseClients } from "../../src/db/client";
import { AdminIdentityService } from "../../src/modules/admin/admin-identity-service";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { createSiteRegistry } from "../../src/modules/shared/site-registry";
import {
	applyCurrentMigrations,
	createTestConfig,
	createTestWorkspace,
	ensureTestDatabase,
} from "./test-fixtures";
export async function createLifecycleFixture(
	input: { empty?: boolean; version?: string } = {},
) {
	const workspace = createTestWorkspace("lifecycle-");
	await ensureTestDatabase(workspace.databaseUrl);
	const config = createTestConfig(
		workspace.databaseUrl,
		workspace.logsDirectory,
	);
	const clients = createDatabaseClients(workspace.databaseUrl, config.database);
	const markerPath = path.join(
		workspace.directory,
		"data/upgrade/partial-upgrade.json",
	);
	const writeConfig = () => {
		mkdirSync(path.dirname(workspace.configPath), { recursive: true });
		writeFileSync(
			workspace.configPath,
			stringify({
				server: config.server,
				database: config.database,
				admin: { session: config.admin.session },
				security: config.security,
			}),
		);
	};
	if (!input.empty) {
		await applyCurrentMigrations(workspace.databaseUrl);
		await new AdminIdentityService(clients.db).ensureInitialAdmin({
			consolePath: "/admin",
			username: "admin",
			passwordHash: createPasswordHash("adminadmin"),
		});
		await createSiteRegistry().seedSiteFromTemplate(clients.db, {
			siteKey: "default",
			name: "Default",
			allowedOrigins: ["http://localhost:4321"],
		});
		await clients.pool.query(
			"INSERT INTO __qingyan_upgrades(name,to_version,summary_json) VALUES($1,$2,'{}')",
			[
				`application-version:${input.version ?? "0.2.5"}`,
				input.version ?? "0.2.5",
			],
		);
		writeConfig();
	}
	return {
		...workspace,
		...clients,
		config,
		markerPath,
		writeConfig,
		minimalConfig: {
			configPath: workspace.configPath,
			host: "127.0.0.1",
			port: 4401,
			publicPath: "/qingyan",
			token: "install-token",
			disabled: false,
			transitionMode: "manual" as const,
		},
		async cleanup() {
			await clients.close();
			await workspace.cleanup();
		},
	};
}
export function installPayload(url: string) {
	return {
		token: "install-token",
		server: {
			host: "127.0.0.1",
			port: 4401,
			publicBaseUrl: "http://localhost:4401",
			publicPath: "/qingyan",
			trustProxy: false,
		},
		database: {
			url,
			pool: { max: 2, connectionTimeoutMs: 5000, idleTimeoutMs: 30000 },
		},
		admin: { consolePath: "/admin", username: "admin", password: "adminadmin" },
		site: {
			siteKey: "default",
			name: "Default",
			allowedOrigins: ["http://localhost:4321"],
		},
	};
}
