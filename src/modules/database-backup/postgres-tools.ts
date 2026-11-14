import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { StartupConfig } from "../../config/types";
import { readSystemSettingsRows } from "../system-settings/codec";
import { defaultSystemSettings } from "../system-settings/definitions";

export function databaseIdentity(url: string): string {
	const parsed = new URL(url);
	return `${parsed.hostname}:${parsed.port || 5432}/${decodeURIComponent(parsed.pathname.slice(1))}`;
}
export function postgresEnvironment(
	database: StartupConfig["database"],
	credentialDirectory: string,
): NodeJS.ProcessEnv {
	const url = new URL(database.url);
	const environment: NodeJS.ProcessEnv = {
		...process.env,
		PGHOST: url.hostname,
		PGPORT: url.port || "5432",
		PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
		PGUSER: decodeURIComponent(url.username),
		PGPASSWORD: decodeURIComponent(url.password),
		PGCONNECT_TIMEOUT: "5",
		PGAPPNAME: "qingyan-operations",
	};
	const sslmode = url.searchParams.get("sslmode");
	if (sslmode) environment.PGSSLMODE = sslmode;
	if (database.tls) {
		environment.PGSSLMODE = database.tls.rejectUnauthorized
			? "verify-full"
			: "require";
		mkdirSync(credentialDirectory, { recursive: true, mode: 0o700 });
		for (const [key, variable] of [
			["ca", "PGSSLROOTCERT"],
			["cert", "PGSSLCERT"],
			["key", "PGSSLKEY"],
		] as const) {
			const value = database.tls[key];
			if (!value) continue;
			const file = path.join(credentialDirectory, `${key}.pem`);
			writeFileSync(file, value, { mode: 0o600 });
			environment[variable] = file;
		}
	}
	return environment;
}
export async function runPostgresTool(
	command: "pg_dump" | "pg_restore" | "psql",
	args: string[],
	database: StartupConfig["database"],
	credentialDirectory: string,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			env: postgresEnvironment(database, credentialDirectory),
			stdio: ["ignore", "ignore", "pipe"],
			windowsHide: true,
		});
		// 客户端原始错误可能包含服务器信息，仅向调用者返回工具与退出状态。
		child.stderr.resume();
		child.once("error", (error) =>
			reject(
				Object.assign(new Error(`${command.toUpperCase()}_UNAVAILABLE`), {
					cause: error,
				}),
			),
		);
		child.once("close", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`${command.toUpperCase()}_FAILED:${code}`)),
		);
	});
}

export interface DatabaseResourceBackup {
	path: string;
	ipVersion: "v4" | "v6";
	resourceOwner: "settings" | "state" | "both";
}

export async function backupDatabaseResources(
	pool: import("pg").Pool,
	outputDirectory: string,
): Promise<DatabaseResourceBackup[]> {
	const state = await pool.query<{
		ip_version: string;
		file_path: string | null;
	}>(
		"SELECT ip_version,file_path FROM ip_region_database_state WHERE file_path IS NOT NULL",
	);
	const settingsRows = await pool.query<{
		category: string;
		key: string;
		valueJson: string;
	}>(
		`SELECT category,key,value_json::text AS "valueJson" FROM system_settings WHERE category='ipRegion'`,
	);
	const settings = readSystemSettingsRows(settingsRows.rows).ipRegion;
	const files: DatabaseResourceBackup[] = [];
	for (const row of state.rows) {
		if (row.ip_version !== "v4" && row.ip_version !== "v6")
			throw new Error("BACKUP_RESOURCE_VERSION_INVALID");
	}
	for (const [ipVersion, settingKey] of [
		["v4", "ipv4"],
		["v6", "ipv6"],
	] as const) {
		const configuredPath = path.resolve(settings[settingKey].dbPath);
		const statePath = state.rows.find(
			(row) => row.ip_version === ipVersion,
		)?.file_path;
		const resources: Array<{
			source: string;
			owner: DatabaseResourceBackup["resourceOwner"];
		}> = [];
		if (existsSync(configuredPath)) {
			resources.push({
				source: configuredPath,
				owner:
					statePath && path.resolve(statePath) === configuredPath
						? "both"
						: "settings",
			});
		} else if (
			settings[settingKey].dbPath !==
			defaultSystemSettings.ipRegion[settingKey].dbPath
		) {
			throw new Error("BACKUP_RESOURCE_MISSING");
		}
		if (statePath && path.resolve(statePath) !== configuredPath) {
			resources.push({ source: statePath, owner: "state" });
		} else if (statePath && !existsSync(configuredPath)) {
			throw new Error("BACKUP_RESOURCE_MISSING");
		}
		for (const resource of resources) {
			if (!existsSync(resource.source))
				throw new Error("BACKUP_RESOURCE_MISSING");
			mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
			const file = path.join(
				outputDirectory,
				`ip2region_${ipVersion}${resource.owner === "state" ? "_state" : ""}.xdb`,
			);
			copyFileSync(resource.source, file);
			files.push({ path: file, ipVersion, resourceOwner: resource.owner });
		}
	}
	return files;
}
