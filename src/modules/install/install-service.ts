import { existsSync } from "node:fs";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import { stringify } from "yaml";

import {
	applyStartupEnvOverrides,
	envMappings,
} from "../../config/env-mapping";
import { configSchema, type StartupConfig } from "../../config/types";
import { createDatabaseClients } from "../../db/client";
import { applyDatabaseMigrations } from "../../db/migrations";
import { adminBootstrapState } from "../../db/schema";
import { createAdminConsolePath } from "../admin/bootstrap-utils";
import {
	createInitialAdminPassword,
	createPasswordHash,
} from "../admin/password-hash";
import { QingYanImportService } from "../import-export/qingyan/import-service";
import type {
	QingYanDryRunResult,
	QingYanExistingStrategy,
	QingYanImportMode,
	QingYanSettingsStrategy,
	QingYanApplyResult,
} from "../import-export/qingyan/import-service";
import {
	parseQingYanExport,
	type QingYanExport,
} from "../import-export/qingyan/export-model";
import { InvalidRequestError } from "../shared/errors";
import { createSiteRegistry } from "../shared/site-registry";
import { AdminSystemSettingsRepository } from "../admin/system-settings-repository";
import { flattenSystemSettings } from "../system-settings/codec";
import { defaultSystemSettings } from "../system-settings/definitions";
import type { MinimalInstallConfig } from "./minimal-config";

const installRestoreOptionsSchema = z
	.object({
		enabled: z.boolean().default(false),
		fileName: z.string().min(1).default("qingyan-export.json"),
		payload: z.unknown(),
		existingStrategy: z
			.enum(["fail_on_existing", "skip_existing"])
			.default("fail_on_existing"),
		importMode: z
			.enum(["data_only", "settings_only", "full_site"])
			.default("full_site"),
		settingsStrategy: z
			.enum(["fail_on_existing", "replace_settings"])
			.default("replace_settings"),
	})
	.optional();

export const installApplySchema = z.object({
	token: z.string().min(1).optional(),
	server: z.object({
		host: z.string().min(1).default("0.0.0.0"),
		port: z.number().int().positive().default(4401),
		publicBaseUrl: z.string().url(),
		trustProxy: z.boolean().default(true),
	}),
	database: z.object({
		sqliteFile: z.string().min(1).default("./data/qingyan.db"),
	}),
	admin: z.object({
		consolePath: z.string().min(1).optional(),
		username: z.string().min(1).optional(),
		password: z.string().min(8).optional(),
	}),
	site: z.object({
		siteKey: z.string().min(1).default("default"),
		name: z.string().min(1).default("Default"),
		allowedOrigins: z.array(z.string().url()).min(1),
	}),
	restore: installRestoreOptionsSchema,
});

export type InstallApplyInput = z.infer<typeof installApplySchema>;
type InstallSiteInput = InstallApplyInput["site"];
type InstallRestoreOptions = {
	enabled: true;
	fileName: string;
	payload: QingYanExport;
	existingStrategy: QingYanExistingStrategy;
	importMode: QingYanImportMode;
	settingsStrategy: QingYanSettingsStrategy;
	site: InstallSiteInput;
};
type NormalizedInstallInput = Omit<
	InstallApplyInput,
	"admin" | "token" | "site" | "restore"
> & {
	token?: string;
	site: InstallSiteInput;
	restore?: InstallRestoreOptions;
	admin: {
		consolePath: string;
		consolePathGenerated: boolean;
		username: string;
		usernameDefaulted: boolean;
		password: string;
		passwordGenerated: boolean;
	};
};

type InstallValueSource = "input" | "generated" | "environment" | "default";

type InstallValueMeta = {
	path: string;
	source: InstallValueSource;
	env?: string;
	secret?: boolean;
	valuePreview?: string | number | boolean | null;
};

type InstallSystemSettingSeed = {
	category: string;
	key: string;
	value: unknown;
	source: "default" | "environment";
	envName?: string;
	secret?: boolean;
};

type ResolvedInstallInput = NormalizedInstallInput & {
	startupConfig: StartupConfig;
	systemSettings: InstallSystemSettingSeed[];
	values: InstallValueMeta[];
};

export interface InstallPlan {
	config: {
		path: string;
		writes: string[];
	};
	database: {
		sqliteFile: string;
		seeds: string[];
	};
	admin: {
		consolePath: string;
		username: string;
		passwordGenerated: boolean;
	};
	site: {
		siteKey: string;
		name: string;
		allowedOrigins: string[];
	};
	restore?: {
		enabled: true;
		fileName: string;
		siteKey: string;
		importMode: QingYanImportMode;
		settingsStrategy: QingYanSettingsStrategy;
		dryRun: QingYanDryRunResult;
	};
	systemSettings: Array<{
		category: string;
		key: string;
		action: "seed";
		source: "default" | "environment";
		envName?: string;
		secret?: boolean;
		valuePreview?: string | number | boolean | null;
	}>;
	env: Array<{
		path: string;
		envName: string;
		locked: boolean;
		secret: boolean;
		source: "env";
		valuePreview?: string | number | boolean | null;
	}>;
	values: InstallValueMeta[];
	applyPayload: Omit<InstallApplyInput, "token">;
	warnings: string[];
}

function parseRestoreOptions(
	restore: InstallApplyInput["restore"],
): InstallRestoreOptions | undefined {
	if (!restore?.enabled) {
		return undefined;
	}
	let payload: QingYanExport;
	try {
		payload = parseQingYanExport(restore.payload);
	} catch (error) {
		throw new InvalidRequestError({
			message:
				error instanceof Error
					? `无效 QingYan 导出文件：${error.message}`
					: "无效 QingYan 导出文件。",
		});
	}
	if (payload.scope.siteKey !== payload.data.site.siteKey) {
		throw new InvalidRequestError({
			message: "导出文件 scope.siteKey 与 data.site.siteKey 不一致。",
		});
	}
	return {
		enabled: true,
		fileName: restore.fileName,
		payload,
		existingStrategy: restore.existingStrategy,
		importMode: restore.importMode,
		settingsStrategy: restore.settingsStrategy,
		site: {
			siteKey: payload.data.site.siteKey,
			name: payload.data.site.name,
			allowedOrigins: payload.data.site.allowedOrigins,
		},
	};
}

function normalizeInstallInput(
	input: InstallApplyInput,
): NormalizedInstallInput {
	const generatedConsolePath = !input.admin.consolePath;
	const defaultedUsername = !input.admin.username;
	const generatedPassword = !input.admin.password;
	const restore = parseRestoreOptions(input.restore);
	return {
		...input,
		site: restore?.site ?? input.site,
		restore,
		admin: {
			consolePath: input.admin.consolePath ?? createAdminConsolePath(),
			consolePathGenerated: generatedConsolePath,
			username: input.admin.username ?? "admin",
			usernameDefaulted: defaultedUsername,
			password: input.admin.password ?? createInitialAdminPassword(),
			passwordGenerated: generatedPassword,
		},
	};
}

function buildStartupConfig(input: NormalizedInstallInput): StartupConfig {
	return {
		server: {
			host: input.server.host,
			port: input.server.port,
			publicBaseUrl: input.server.publicBaseUrl,
			trustProxy: input.server.trustProxy,
		},
		database: {
			client: "sqlite",
			sqlite: {
				file: input.database.sqliteFile,
			},
		},
		admin: {
			session: {
				cookieName: "qingyan_admin",
				ttlMinutes: 1440,
				sameSite: "lax",
				secure: input.server.publicBaseUrl.startsWith("https://"),
			},
		},
		security: {
			requestIdHeader: "x-request-id",
			globalFloodGuard: {
				enabled: true,
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

function readPathValue(source: unknown, valuePath: string): unknown {
	let cursor = source;
	for (const key of valuePath.split(".")) {
		if (!cursor || typeof cursor !== "object") {
			return undefined;
		}
		cursor = (cursor as Record<string, unknown>)[key];
	}
	return cursor;
}

function previewValue(value: unknown): string | number | boolean | null {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	return value === null || value === undefined ? null : String(value);
}

function splitSystemSettingPath(settingPath: string): {
	category: string;
	key: string;
} {
	const [category, ...keyParts] = settingPath.split(".");
	if (!category || keyParts.length === 0) {
		throw new Error(`Invalid system setting path: ${settingPath}`);
	}
	return {
		category,
		key: keyParts.join("."),
	};
}

function buildSystemSettingSeeds(
	environment: NodeJS.ProcessEnv,
): InstallSystemSettingSeed[] {
	const seeds: InstallSystemSettingSeed[] = flattenSystemSettings(
		defaultSystemSettings,
	).map((row) => ({
		category: row.category,
		key: row.key,
		value: row.value,
		source: "default" as const,
		secret: row.secret || undefined,
	}));
	const seedByPath = new Map(
		seeds.map((seed, index) => [`${seed.category}.${seed.key}`, index]),
	);
	for (const mapping of envMappings) {
		if (mapping.category !== "system_settings_seed") {
			continue;
		}
		const value = environment[mapping.envName];
		if (value === undefined) {
			continue;
		}
		const seed: InstallSystemSettingSeed = {
			...splitSystemSettingPath(mapping.path),
			value,
			source: "environment",
			envName: mapping.envName,
			secret: mapping.secret,
		};
		const index = seedByPath.get(mapping.path);
		if (index === undefined) {
			seedByPath.set(mapping.path, seeds.length);
			seeds.push(seed);
		} else {
			seeds[index] = seed;
		}
	}
	return seeds;
}

function buildValueMeta(input: {
	normalized: NormalizedInstallInput;
	startupConfig: StartupConfig;
	environment: NodeJS.ProcessEnv;
}): InstallValueMeta[] {
	const values: InstallValueMeta[] = [
		{
			path: "admin.consolePath",
			source: input.normalized.admin.consolePathGenerated
				? "generated"
				: "input",
			valuePreview: input.normalized.admin.consolePath,
		},
		{
			path: "admin.username",
			source: input.normalized.admin.usernameDefaulted ? "default" : "input",
			valuePreview: input.normalized.admin.username,
		},
		{
			path: "admin.password",
			source: input.normalized.admin.passwordGenerated ? "generated" : "input",
			secret: true,
			valuePreview: input.normalized.admin.passwordGenerated
				? "generated"
				: "configured",
		},
	];

	for (const mapping of envMappings) {
		if (mapping.category !== "startup") {
			continue;
		}
		const hasEnv = input.environment[mapping.envName] !== undefined;
		values.push({
			path: mapping.path,
			source: hasEnv ? "environment" : "input",
			env: hasEnv ? mapping.envName : undefined,
			secret: mapping.secret,
			valuePreview: mapping.secret
				? "configured"
				: previewValue(readPathValue(input.startupConfig, mapping.path)),
		});
	}

	for (const seed of buildSystemSettingSeeds(input.environment)) {
		if (seed.source !== "environment") {
			continue;
		}
		values.push({
			path: `${seed.category}.${seed.key}`,
			source: "environment",
			env: seed.envName,
			secret: seed.secret,
			valuePreview: seed.secret ? "configured" : previewValue(seed.value),
		});
	}

	return values;
}

function resolveInstallConfigInput(input: {
	payload: InstallApplyInput;
	environment?: NodeJS.ProcessEnv;
}): ResolvedInstallInput {
	const normalized = normalizeInstallInput(input.payload);
	const environment = input.environment ?? process.env;
	const startupConfig = configSchema.parse(
		applyStartupEnvOverrides(buildStartupConfig(normalized), environment),
	);
	const systemSettings = buildSystemSettingSeeds(environment);
	return {
		...normalized,
		server: startupConfig.server,
		database: {
			sqliteFile: startupConfig.database.sqlite.file,
		},
		startupConfig,
		systemSettings,
		values: buildValueMeta({
			normalized,
			startupConfig,
			environment,
		}),
	};
}

function buildApplyPayload(
	input: ResolvedInstallInput,
): Omit<InstallApplyInput, "token"> {
	const adminPayload: Omit<InstallApplyInput["admin"], "password"> & {
		password?: string;
	} = {
		consolePath: input.admin.consolePath,
		username: input.admin.username,
	};
	if (!input.admin.passwordGenerated) {
		adminPayload.password = input.admin.password;
	}
	const payload: Omit<InstallApplyInput, "token"> = {
		server: {
			host: input.startupConfig.server.host,
			port: input.startupConfig.server.port,
			publicBaseUrl: input.startupConfig.server.publicBaseUrl,
			trustProxy: input.startupConfig.server.trustProxy,
		},
		database: {
			sqliteFile: input.startupConfig.database.sqlite.file,
		},
		admin: adminPayload,
		site: input.site,
	};
	if (input.restore) {
		payload.restore = {
			enabled: true,
			fileName: input.restore.fileName,
			payload: input.restore.payload,
			existingStrategy: input.restore.existingStrategy,
			importMode: input.restore.importMode,
			settingsStrategy: input.restore.settingsStrategy,
		};
	}
	return payload;
}

function timestampForBackup(): string {
	const now = new Date();
	const pad = (value: number) => String(value).padStart(2, "0");
	return [
		now.getFullYear(),
		pad(now.getMonth() + 1),
		pad(now.getDate()),
		pad(now.getHours()),
		pad(now.getMinutes()),
		pad(now.getSeconds()),
	].join("");
}

async function writeStartupConfig(
	configPath: string,
	config: StartupConfig,
): Promise<string | undefined> {
	const validated = configSchema.parse(config);
	await mkdir(path.dirname(configPath), { recursive: true });
	let backupPath: string | undefined;
	if (existsSync(configPath)) {
		backupPath = `${configPath}.bak-${timestampForBackup()}`;
		await copyFile(configPath, backupPath);
	}
	const tmpPath = `${configPath}.${Date.now()}.tmp`;
	await writeFile(tmpPath, stringify(validated), "utf-8");
	await rename(tmpPath, configPath);
	return backupPath;
}

async function seedDatabase(input: {
	databaseFile: string;
	admin: NormalizedInstallInput["admin"];
	site: InstallApplyInput["site"];
	systemSettings: InstallSystemSettingSeed[];
	restore?: InstallRestoreOptions;
}): Promise<QingYanApplyResult | undefined> {
	const { db, sqlite } = createDatabaseClients(input.databaseFile);
	try {
		applyDatabaseMigrations(sqlite);
		const registry = createSiteRegistry();
		await db.insert(adminBootstrapState).values({
			id: 1,
			consolePath: input.admin.consolePath,
			username: input.admin.username,
			passwordHash: createPasswordHash(input.admin.password),
			passwordRotatedAt: null,
		});
		await registry.seedSiteFromTemplate(db, input.site);
		const systemSettings = new AdminSystemSettingsRepository(db);
		for (const seed of input.systemSettings) {
			await systemSettings.upsert(seed.category, seed.key, seed.value);
		}
		if (!input.restore) {
			return undefined;
		}
		return applyRestoreImport(sqlite, input.restore);
	} finally {
		sqlite.close();
	}
}

async function buildRestoreDryRun(
	restore: InstallRestoreOptions,
): Promise<QingYanDryRunResult> {
	const { db, sqlite } = createDatabaseClients(":memory:");
	try {
		applyDatabaseMigrations(sqlite);
		const registry = createSiteRegistry();
		await registry.seedSiteFromTemplate(db, restore.site);
		const importService = new QingYanImportService(sqlite);
		return importService.createDryRun({
			siteKey: restore.site.siteKey,
			fileName: restore.fileName,
			payload: restore.payload,
			existingStrategy: restore.existingStrategy,
			importMode: restore.importMode,
			settingsStrategy: restore.settingsStrategy,
		}).dryRun;
	} finally {
		sqlite.close();
	}
}

function applyRestoreImport(
	sqlite: ReturnType<typeof createDatabaseClients>["sqlite"],
	restore: InstallRestoreOptions,
): QingYanApplyResult {
	const importService = new QingYanImportService(sqlite);
	const dryRun = importService.createDryRun({
		siteKey: restore.site.siteKey,
		fileName: restore.fileName,
		payload: restore.payload,
		existingStrategy: restore.existingStrategy,
		importMode: restore.importMode,
		settingsStrategy: restore.settingsStrategy,
	});
	if (dryRun.dryRun.summary.conflicts > 0) {
		throw new InvalidRequestError({
			message: "恢复计划仍存在冲突，不能执行安装恢复。",
		});
	}
	return importService.apply(dryRun.job.id, {
		existingStrategy: restore.existingStrategy,
		importMode: restore.importMode,
		settingsStrategy: restore.settingsStrategy,
	}).apply;
}

export async function buildInstallPlan(input: {
	minimalConfig: MinimalInstallConfig;
	payload: InstallApplyInput;
	environment?: NodeJS.ProcessEnv;
}): Promise<InstallPlan> {
	const environment = input.environment ?? process.env;
	const resolved = resolveInstallConfigInput({
		payload: input.payload,
		environment,
	});
	const env = envMappings
		.filter((mapping) => environment[mapping.envName] !== undefined)
		.map((mapping) => ({
			path: mapping.path,
			envName: mapping.envName,
			locked: true,
			secret: mapping.secret,
			source: "env" as const,
			valuePreview: mapping.secret
				? "configured"
				: previewValue(readPathValue(resolved.startupConfig, mapping.path)),
		}));
	const restoreDryRun = resolved.restore
		? await buildRestoreDryRun(resolved.restore)
		: undefined;

	return {
		config: {
			path: input.minimalConfig.configPath,
			writes: ["server", "database", "admin.session", "security"],
		},
		database: {
			sqliteFile: resolved.startupConfig.database.sqlite.file,
			seeds: [
				"admin_bootstrap_state",
				"sites",
				"site_settings",
				"system_settings",
			],
		},
		admin: {
			consolePath: resolved.admin.consolePath,
			username: resolved.admin.username,
			passwordGenerated: resolved.admin.passwordGenerated,
		},
		site: {
			siteKey: resolved.site.siteKey,
			name: resolved.site.name,
			allowedOrigins: resolved.site.allowedOrigins,
		},
		restore:
			resolved.restore && restoreDryRun
				? {
						enabled: true,
						fileName: resolved.restore.fileName,
						siteKey: resolved.restore.site.siteKey,
						importMode: resolved.restore.importMode,
						settingsStrategy: resolved.restore.settingsStrategy,
						dryRun: restoreDryRun,
					}
				: undefined,
		systemSettings: resolved.systemSettings.map((seed) => ({
			category: seed.category,
			key: seed.key,
			action: "seed",
			source: seed.source,
			envName: seed.envName,
			secret: seed.secret,
			valuePreview: seed.secret ? "configured" : previewValue(seed.value),
		})),
		env,
		values: resolved.values,
		applyPayload: buildApplyPayload(resolved),
		warnings: [
			"安装完成后需要重启 QingYan 才会进入正常服务。",
			"安装完成后的后台入口由本次写入的 admin bootstrap 决定。",
		],
	};
}

export async function applyInstall(input: {
	minimalConfig: MinimalInstallConfig;
	payload: InstallApplyInput;
	environment?: NodeJS.ProcessEnv;
}) {
	if (input.payload.token !== input.minimalConfig.token) {
		throw new Error("INSTALL_TOKEN_INVALID");
	}

	const resolved = resolveInstallConfigInput({
		payload: input.payload,
		environment: input.environment,
	});
	const startupConfig = resolved.startupConfig;
	const backupPath = await writeStartupConfig(
		input.minimalConfig.configPath,
		startupConfig,
	);
	const databaseFile = path.resolve(
		process.cwd(),
		startupConfig.database.sqlite.file,
	);
	await mkdir(path.dirname(databaseFile), { recursive: true });
	const restoreApply = await seedDatabase({
		databaseFile,
		admin: resolved.admin,
		site: resolved.site,
		systemSettings: resolved.systemSettings,
		restore: resolved.restore,
	});

	return {
		adminUrl: new URL(
			resolved.admin.consolePath,
			startupConfig.server.publicBaseUrl,
		).toString(),
		username: resolved.admin.username,
		initialPassword: resolved.admin.password,
		configPath: input.minimalConfig.configPath,
		databasePath: databaseFile,
		backupPath,
		systemSettings: resolved.systemSettings.map((seed) => ({
			category: seed.category,
			key: seed.key,
			source: seed.source,
			envName: seed.envName,
			secret: seed.secret,
			valuePreview: seed.secret ? "configured" : previewValue(seed.value),
		})),
		restore: resolved.restore
			? {
					enabled: true,
					fileName: resolved.restore.fileName,
					siteKey: resolved.restore.site.siteKey,
					importMode: resolved.restore.importMode,
					settingsStrategy: resolved.restore.settingsStrategy,
					apply: restoreApply,
				}
			: undefined,
		restartRequired: true,
	};
}
