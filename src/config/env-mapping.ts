import type { StartupConfig } from "./types";

type EnvValueKind = "string" | "number" | "boolean" | "sameSite";

export interface EnvMapping {
	path: string;
	envName: string;
	category: "startup" | "system_settings_seed";
	valueKind: EnvValueKind;
	secret: boolean;
	readable: boolean;
	restartRequired: boolean;
}

export const envMappings: EnvMapping[] = [
	{
		path: "server.host",
		envName: "QINGYAN_SERVER_HOST",
		category: "startup",
		valueKind: "string",
		secret: false,
		readable: true,
		restartRequired: true,
	},
	{
		path: "server.port",
		envName: "QINGYAN_SERVER_PORT",
		category: "startup",
		valueKind: "number",
		secret: false,
		readable: true,
		restartRequired: true,
	},
	{
		path: "server.publicBaseUrl",
		envName: "QINGYAN_PUBLIC_BASE_URL",
		category: "startup",
		valueKind: "string",
		secret: false,
		readable: true,
		restartRequired: true,
	},
	{
		path: "server.trustProxy",
		envName: "QINGYAN_TRUST_PROXY",
		category: "startup",
		valueKind: "boolean",
		secret: false,
		readable: true,
		restartRequired: true,
	},
	{
		path: "database.sqlite.file",
		envName: "QINGYAN_SQLITE_FILE",
		category: "startup",
		valueKind: "string",
		secret: false,
		readable: true,
		restartRequired: true,
	},
	{
		path: "admin.session.cookieName",
		envName: "QINGYAN_ADMIN_SESSION_COOKIE_NAME",
		category: "startup",
		valueKind: "string",
		secret: false,
		readable: true,
		restartRequired: true,
	},
	{
		path: "admin.session.ttlMinutes",
		envName: "QINGYAN_ADMIN_SESSION_TTL_MINUTES",
		category: "startup",
		valueKind: "number",
		secret: false,
		readable: true,
		restartRequired: true,
	},
	{
		path: "admin.session.sameSite",
		envName: "QINGYAN_ADMIN_SESSION_SAME_SITE",
		category: "startup",
		valueKind: "sameSite",
		secret: false,
		readable: true,
		restartRequired: true,
	},
	{
		path: "admin.session.secure",
		envName: "QINGYAN_ADMIN_SESSION_SECURE",
		category: "startup",
		valueKind: "boolean",
		secret: false,
		readable: true,
		restartRequired: true,
	},
	{
		path: "mail.smtp.password",
		envName: "QINGYAN_SMTP_PASSWORD",
		category: "system_settings_seed",
		valueKind: "string",
		secret: true,
		readable: false,
		restartRequired: false,
	},
	{
		path: "captcha.turnstile.secretKey",
		envName: "QINGYAN_TURNSTILE_SECRET_KEY",
		category: "system_settings_seed",
		valueKind: "string",
		secret: true,
		readable: false,
		restartRequired: false,
	},
];

function parseEnvValue(mapping: EnvMapping, rawValue: string): unknown {
	if (mapping.valueKind === "number") {
		const value = Number(rawValue);
		if (!Number.isFinite(value)) {
			throw new Error(`${mapping.envName} must be a number.`);
		}
		return value;
	}
	if (mapping.valueKind === "boolean") {
		const normalized = rawValue.trim().toLowerCase();
		if (normalized === "true") {
			return true;
		}
		if (normalized === "false") {
			return false;
		}
		throw new Error(`${mapping.envName} must be true or false.`);
	}
	if (mapping.valueKind === "sameSite") {
		const normalized = rawValue.trim().toLowerCase();
		if (
			normalized === "strict" ||
			normalized === "lax" ||
			normalized === "none"
		) {
			return normalized;
		}
		throw new Error(`${mapping.envName} must be strict, lax, or none.`);
	}
	return rawValue;
}

function setPathValue(
	target: Record<string, unknown>,
	path: string,
	value: unknown,
) {
	const keys = path.split(".");
	let cursor = target;
	for (const key of keys.slice(0, -1)) {
		const current = cursor[key];
		if (!current || typeof current !== "object" || Array.isArray(current)) {
			cursor[key] = {};
		}
		cursor = cursor[key] as Record<string, unknown>;
	}
	cursor[keys[keys.length - 1] ?? ""] = value;
}

export function applyStartupEnvOverrides(
	config: unknown,
	environment: NodeJS.ProcessEnv,
): unknown {
	const nextConfig =
		config && typeof config === "object"
			? structuredClone(config)
			: ({} as Record<string, unknown>);

	for (const mapping of envMappings) {
		if (mapping.category !== "startup") {
			continue;
		}
		const rawValue = environment[mapping.envName];
		if (rawValue === undefined) {
			continue;
		}
		setPathValue(
			nextConfig as Record<string, unknown>,
			mapping.path,
			parseEnvValue(mapping, rawValue),
		);
	}

	return nextConfig satisfies Partial<StartupConfig>;
}
