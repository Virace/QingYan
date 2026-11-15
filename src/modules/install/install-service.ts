import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { stringify } from "yaml";
import { z } from "zod";
import {
	applyStartupEnvOverrides,
	envMappings,
} from "../../config/env-mapping";
import { buildPublicUrl } from "../../config/public-path";
import { configSchema, type StartupConfig } from "../../config/types";
import { createDatabaseClients } from "../../db/client";
import { applyDatabaseMigrations } from "../../db/migrations";
import { siteSettings } from "../../db/schema";
import { AdminIdentityService } from "../admin/admin-identity-service";
import { createAdminConsolePath } from "../admin/bootstrap-utils";
import {
	createInitialAdminPassword,
	createPasswordHash,
} from "../admin/password-hash";
import { AdminSystemSettingsRepository } from "../admin/system-settings-repository";
import {
	normalizeExternalAvatarBaseUrl,
	validateExternalAvatarQuery,
} from "../comments/gravatar";
import {
	type IpRegionUpdateResult,
	IpRegionUpdater,
	type IpVersion,
} from "../comments/metadata/ip-region-updater";
import {
	normalizeVerifiedAuthorEmail,
	serializeVerifiedAuthorSettings,
	type VerifiedAuthorSettings,
} from "../comments/verified-author";
import { databaseIdentity } from "../database-backup/postgres-tools";
import { AppError } from "../shared/errors";
import { createSiteRegistry } from "../shared/site-registry";
import {
	defaultEngagementSettings,
	type EngagementSettings,
	mergeEngagementSettings,
	serializeEngagementSettings,
} from "../shared/site-settings-defaults";
import {
	isSafeHttpUrl,
	normalizeOriginList,
	sanitizeOptionalSafeHttpUrl,
} from "../shared/url-policy";
import {
	flattenSystemSettings,
	readSystemSettingsRows,
	type SystemSettingRow,
} from "../system-settings/codec";
import {
	createSystemSettingsDefaults,
	defaultAdminSessionTtlMinutes,
	type SystemSettings,
	systemSettingsSchema,
} from "../system-settings/definitions";
import {
	removePartialUpgradeMarker,
	updatePartialUpgradeMarker,
	writePartialUpgradeMarker,
} from "../upgrade/partial-marker";
import { classifyConnectionError } from "../upgrade/state";
import type { MinimalInstallConfig } from "./minimal-config";
import { writeInstallLock } from "./state";

const installVerifiedAuthorSchema = z
	.object({
		enabled: z.boolean(),
		displayName: z.string().trim().min(1),
		email: z.string().trim().email().or(z.literal("")),
		website: z
			.string()
			.trim()
			.refine((value) => value === "" || isSafeHttpUrl(value), {
				message: "website 仅允许 http 或 https。",
			}),
		badgeLabel: z.string().trim().min(1),
	})
	.superRefine((value, context) => {
		if (value.enabled && !value.email.trim()) {
			context.addIssue({
				code: "custom",
				path: ["email"],
				message: "启用可信评论作者时必须填写邮箱。",
			});
		}
	})
	.transform((value) => ({
		enabled: value.enabled,
		displayName: value.displayName.trim(),
		email: normalizeVerifiedAuthorEmail(value.email),
		website: sanitizeOptionalSafeHttpUrl(value.website) ?? "",
		badgeLabel: value.badgeLabel.trim(),
	}));

const installEngagementSchema = z
	.object({
		visitors: z
			.object({
				enabled: z.boolean().optional(),
			})
			.optional(),
		pageViews: z
			.object({
				enabled: z.boolean().optional(),
			})
			.optional(),
		pageLikes: z
			.object({
				enabled: z.boolean().optional(),
			})
			.optional(),
		commentVotes: z
			.object({
				enabled: z.boolean().optional(),
			})
			.optional(),
	})
	.optional()
	.transform((value) =>
		mergeEngagementSettings(value ?? defaultEngagementSettings),
	);

export const installApplySchema = z.object({
	token: z.string().min(1).optional(),
	server: z.object({
		host: z.string().min(1).default("0.0.0.0"),
		port: z.number().int().positive().default(4401),
		publicBaseUrl: z.string().url(),
		publicPath: configSchema.shape.server.shape.publicPath,
		trustProxy: z.boolean().default(true),
	}),
	database: configSchema.shape.database,
	admin: z.object({
		consolePath: z.string().min(1).optional(),
		username: z.string().min(1).optional(),
		password: z.string().min(8).optional(),
		session: z
			.object({
				cookieName: z.string().min(1).default("qingyan_admin"),
				ttlMinutes: z
					.number()
					.int()
					.positive()
					.default(defaultAdminSessionTtlMinutes),
				sameSite: z.enum(["strict", "lax", "none"]).default("lax"),
				secure: z.boolean().optional(),
			})
			.optional(),
	}),
	security: configSchema.shape.security.optional(),
	site: z.object({
		siteKey: z.string().min(1).default("default"),
		name: z.string().min(1).default("Default"),
		allowedOrigins: z
			.array(z.string().min(1))
			.length(1, "每个站点只能配置一个前端 Origin。")
			.transform((value) => normalizeOriginList(value)),
	}),
	siteSettings: z
		.object({
			comments: z
				.object({
					verifiedAuthor: installVerifiedAuthorSchema.optional(),
				})
				.optional(),
			engagement: installEngagementSchema,
		})
		.optional(),
	systemSettings: z.unknown().optional(),
});

export type InstallApplyInput = z.infer<typeof installApplySchema>;
type InstallSiteInput = InstallApplyInput["site"];
type InstallSiteSettingsInput = {
	comments?: {
		verifiedAuthor: VerifiedAuthorSettings;
	};
	engagement: EngagementSettings;
};
type NormalizedInstallInput = Omit<
	InstallApplyInput,
	"admin" | "token" | "site"
> & {
	token?: string;
	site: InstallSiteInput;
	siteSettings?: InstallSiteSettingsInput;
	admin: {
		consolePath: string;
		consolePathGenerated: boolean;
		username: string;
		usernameDefaulted: boolean;
		password: string;
		passwordGenerated: boolean;
		session?: InstallApplyInput["admin"]["session"];
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

export type InstallIpRegionBootstrapResult = IpRegionUpdateResult & {
	ipVersion: IpVersion;
};

export interface InstallIpRegionUpdater {
	update(input: {
		ipVersion: IpVersion;
		config: SystemSettings["ipRegion"];
	}): Promise<IpRegionUpdateResult>;
}

type ResolvedInstallInput = NormalizedInstallInput & {
	startupConfig: StartupConfig;
	systemSettingSeeds: InstallSystemSettingSeed[];
	values: InstallValueMeta[];
};

const defaultSecurityConfig: StartupConfig["security"] = {
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
};

export interface InstallPlan {
	config: {
		path: string;
		writes: string[];
	};
	database: {
		url: string;
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
	siteSettings?: InstallSiteSettingsInput;
	systemSettings: Array<{
		category: string;
		key: string;
		action: "seed";
		source: "default" | "environment";
		envName?: string;
		secret?: boolean;
		valuePreview?: string | number | boolean | null;
	}>;
	systemSettingsReview: {
		defaultSeedCount: number;
		environmentSeeds: Array<{
			path: string;
			envName: string;
			secret: boolean;
			valuePreview?: string | number | boolean | null;
		}>;
	};
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

function normalizeInstallInput(
	input: InstallApplyInput,
): NormalizedInstallInput {
	const generatedConsolePath = !input.admin.consolePath;
	const defaultedUsername = !input.admin.username;
	const generatedPassword = !input.admin.password;
	const siteSettingsInput: InstallSiteSettingsInput = {
		comments: input.siteSettings?.comments?.verifiedAuthor
			? {
					verifiedAuthor: input.siteSettings.comments.verifiedAuthor,
				}
			: undefined,
		engagement: input.siteSettings?.engagement ?? defaultEngagementSettings,
	};
	return {
		...input,
		site: input.site,
		siteSettings: siteSettingsInput,
		admin: {
			consolePath: input.admin.consolePath ?? createAdminConsolePath(),
			consolePathGenerated: generatedConsolePath,
			username: input.admin.username ?? "admin",
			usernameDefaulted: defaultedUsername,
			password: input.admin.password ?? createInitialAdminPassword(),
			passwordGenerated: generatedPassword,
			session: input.admin.session,
		},
	};
}

function buildStartupConfig(input: NormalizedInstallInput): StartupConfig {
	const session = input.admin.session;
	const sessionSecure =
		session?.secure ?? input.server.publicBaseUrl.startsWith("https://");
	return {
		server: {
			host: input.server.host,
			port: input.server.port,
			publicBaseUrl: input.server.publicBaseUrl,
			publicPath: input.server.publicPath,
			trustProxy: input.server.trustProxy,
		},
		database: input.database,
		admin: {
			session: {
				cookieName: session?.cookieName ?? "qingyan_admin",
				ttlMinutes: defaultAdminSessionTtlMinutes,
				sameSite: session?.sameSite ?? "lax",
				secure: sessionSecure,
			},
		},
		security: input.security ?? defaultSecurityConfig,
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

function parseEnvValue(
	mapping: { valueKind: string; envName: string },
	rawValue: string,
) {
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

function mergePlainObject(base: unknown, override: unknown): unknown {
	if (override === undefined) {
		return base;
	}
	if (
		!base ||
		typeof base !== "object" ||
		Array.isArray(base) ||
		!override ||
		typeof override !== "object" ||
		Array.isArray(override)
	) {
		return override;
	}

	const next = structuredClone(base) as Record<string, unknown>;
	for (const [key, value] of Object.entries(override)) {
		if (value !== undefined) {
			next[key] = mergePlainObject(next[key], value);
		}
	}
	return next;
}

function buildSystemSettingsInput(input: unknown): SystemSettings {
	const settings = systemSettingsSchema.parse(
		mergePlainObject(createSystemSettingsDefaults(), input),
	);
	return {
		...settings,
		avatar: {
			external: {
				...settings.avatar.external,
				baseUrl: normalizeExternalAvatarBaseUrl(
					settings.avatar.external.baseUrl,
				),
				query: validateExternalAvatarQuery(settings.avatar.external.query),
			},
			display: settings.avatar.display,
		},
	};
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
	systemSettingsInput: unknown,
	adminSessionInput?: InstallApplyInput["admin"]["session"],
): InstallSystemSettingSeed[] {
	const seeds: InstallSystemSettingSeed[] = flattenSystemSettings(
		buildSystemSettingsInput(
			mergePlainObject(systemSettingsInput, {
				admin: {
					session: {
						ttlMinutes:
							adminSessionInput?.ttlMinutes ?? defaultAdminSessionTtlMinutes,
					},
				},
			}),
		),
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
			value: parseEnvValue(mapping, value),
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

function buildSystemSettingsReview(seeds: InstallSystemSettingSeed[]) {
	const environmentSeeds = seeds
		.filter((seed) => seed.source === "environment" && seed.envName)
		.map((seed) => ({
			path: `${seed.category}.${seed.key}`,
			envName: seed.envName ?? "",
			secret: Boolean(seed.secret),
			valuePreview: seed.secret ? "configured" : previewValue(seed.value),
		}));

	return {
		defaultSeedCount: seeds.length - environmentSeeds.length,
		environmentSeeds,
	};
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

	for (const seed of buildSystemSettingSeeds(
		input.environment,
		input.normalized.systemSettings,
		input.normalized.admin.session,
	)) {
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
	const systemSettings = buildSystemSettingSeeds(
		environment,
		normalized.systemSettings,
		normalized.admin.session,
	);
	return {
		...normalized,
		server: startupConfig.server,
		database: startupConfig.database,
		startupConfig,
		systemSettingSeeds: systemSettings,
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
	const adminSession = {
		...input.startupConfig.admin.session,
		ttlMinutes:
			input.admin.session?.ttlMinutes ??
			input.startupConfig.admin.session.ttlMinutes,
	};
	const adminPayload: Omit<InstallApplyInput["admin"], "password"> & {
		password?: string;
	} = {
		consolePath: input.admin.consolePath,
		username: input.admin.username,
		session: adminSession,
	};
	if (!input.admin.passwordGenerated) {
		adminPayload.password = input.admin.password;
	}
	const payload: Omit<InstallApplyInput, "token"> = {
		server: {
			host: input.startupConfig.server.host,
			port: input.startupConfig.server.port,
			publicBaseUrl: input.startupConfig.server.publicBaseUrl,
			publicPath: input.startupConfig.server.publicPath,
			trustProxy: input.startupConfig.server.trustProxy,
		},
		database: input.startupConfig.database,
		admin: adminPayload,
		security: input.startupConfig.security,
		site: input.site,
		systemSettings: input.systemSettings,
	};
	if (input.siteSettings) {
		payload.siteSettings = input.siteSettings;
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
	stagedConfigPath?: string,
): Promise<string | undefined> {
	const validated = configSchema.parse(config);
	await mkdir(path.dirname(configPath), { recursive: true });
	let backupPath: string | undefined;
	if (existsSync(configPath)) {
		backupPath = `${configPath}.bak-${timestampForBackup()}`;
		await copyFile(configPath, backupPath);
	}
	const tmpPath = stagedConfigPath ?? `${configPath}.${Date.now()}.tmp`;
	await writeFile(tmpPath, stringify(validated), {
		encoding: "utf-8",
		mode: 0o600,
	});
	await rename(tmpPath, configPath);
	return backupPath;
}

async function seedDatabase(input: {
	database: StartupConfig["database"];
	admin: NormalizedInstallInput["admin"];
	site: InstallApplyInput["site"];
	siteSettings?: InstallSiteSettingsInput;
	systemSettings: InstallSystemSettingSeed[];
	ipRegionUpdater?: InstallIpRegionUpdater;
}): Promise<{
	ipRegionBootstrap: InstallIpRegionBootstrapResult[];
}> {
	const { db, pool, close } = createDatabaseClients(
		input.database.url,
		input.database,
	);
	try {
		await applyDatabaseMigrations(pool);
		await db.transaction(async (tx) => {
			const registry = createSiteRegistry();
			await new AdminIdentityService(tx).ensureInitialAdmin({
				consolePath: input.admin.consolePath,
				username: input.admin.username,
				passwordHash: createPasswordHash(input.admin.password),
			});

			const registeredSite = await registry.seedSiteFromTemplate(
				tx,
				input.site,
			);
			if (input.siteSettings) {
				await tx
					.update(siteSettings)
					.set({
						verifiedAuthorJson: input.siteSettings.comments
							? serializeVerifiedAuthorSettings(
									input.siteSettings.comments.verifiedAuthor,
								)
							: undefined,
						allowPageLike: input.siteSettings.engagement.pageLikes.enabled,
						engagementJson: serializeEngagementSettings(
							input.siteSettings.engagement,
						),
					})
					.where(eq(siteSettings.siteId, registeredSite.id));
			}
			const systemSettings = new AdminSystemSettingsRepository(tx);
			for (const seed of input.systemSettings) {
				await systemSettings.upsert(seed.category, seed.key, seed.value);
			}
			const version = (
				JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
					version: string;
				}
			).version;
			await tx.execute(
				sql`INSERT INTO __qingyan_upgrades(name,to_version,summary_json) VALUES(${`application-version:${version}`},${version},'{}'::jsonb)`,
			);
		});

		const ipRegionBootstrap = await bootstrapIpRegionDatabase({
			db,
			settings: (await new AdminSystemSettingsRepository(
				db,
			).listAll()) as SystemSettingRow[],
			updater: input.ipRegionUpdater,
		});
		return {
			ipRegionBootstrap,
		};
	} finally {
		await close();
	}
}

async function bootstrapIpRegionDatabase(input: {
	db: ReturnType<typeof createDatabaseClients>["db"];
	settings: SystemSettingRow[];
	updater?: InstallIpRegionUpdater;
}): Promise<InstallIpRegionBootstrapResult[]> {
	const ipRegion = readSystemSettingsRows(input.settings).ipRegion;
	if (!ipRegion.enabled) {
		return [];
	}
	const updater = input.updater ?? new IpRegionUpdater(input.db);
	const results: InstallIpRegionBootstrapResult[] = [];
	for (const ipVersion of ["v4", "v6"] as const) {
		const result = await updater.update({ ipVersion, config: ipRegion });
		results.push({
			ipVersion,
			...result,
		});
	}
	return results;
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
				: previewValue(
						mapping.category === "system_settings_seed"
							? parseEnvValue(mapping, environment[mapping.envName] ?? "")
							: readPathValue(resolved.startupConfig, mapping.path),
					),
		}));
	await inspectInstallDatabase(resolved.startupConfig.database);

	return {
		config: {
			path: input.minimalConfig.configPath,
			writes: ["server", "database", "admin.session", "security"],
		},
		database: {
			url: "[redacted]",
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
		siteSettings: resolved.siteSettings
			? {
					comments: resolved.siteSettings.comments
						? {
								verifiedAuthor: resolved.siteSettings.comments.verifiedAuthor,
							}
						: undefined,
					engagement: resolved.siteSettings.engagement,
				}
			: undefined,
		systemSettings: resolved.systemSettingSeeds.map((seed) => ({
			category: seed.category,
			key: seed.key,
			action: "seed",
			source: seed.source,
			envName: seed.envName,
			secret: seed.secret,
			valuePreview: seed.secret ? "configured" : previewValue(seed.value),
		})),
		systemSettingsReview: buildSystemSettingsReview(
			resolved.systemSettingSeeds,
		),
		env,
		values: resolved.values,
		applyPayload: {
			...buildApplyPayload(resolved),
			database: {
				...resolved.database,
				url: "[redacted]",
				tls: resolved.database.tls
					? { rejectUnauthorized: resolved.database.tls.rejectUnauthorized }
					: undefined,
			},
		},
		warnings: [
			"安装完成后会按安装切换模式进入正常服务；manual 模式需要人工重启 QingYan。",
			"安装完成后的后台入口由本次写入的 admin bootstrap 决定。",
		],
	};
}

export async function applyInstall(input: {
	minimalConfig: MinimalInstallConfig;
	payload: InstallApplyInput;
	environment?: NodeJS.ProcessEnv;
	ipRegionUpdater?: InstallIpRegionUpdater;
}) {
	if (input.payload.token !== input.minimalConfig.token) {
		throw new Error("INSTALL_TOKEN_INVALID");
	}

	const resolved = resolveInstallConfigInput({
		payload: input.payload,
		environment: input.environment,
	});
	const startupConfig = resolved.startupConfig;
	await inspectInstallDatabase(startupConfig.database);
	const markerPath = path.resolve(
		path.dirname(input.minimalConfig.configPath),
		"../data/upgrade/partial-upgrade.json",
	);
	const stagedConfigPath = `${input.minimalConfig.configPath}.install-staged`;
	await mkdir(path.dirname(stagedConfigPath), { recursive: true });
	writePartialUpgradeMarker({
		markerPath,
		fromVersion: "not_installed",
		toVersion: (
			JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
				version: string;
			}
		).version,
		stagedConfigPath,
		planPath: "",
		backupDirectory: "",
		currentStep: "install-database",
		targetIdentity: databaseIdentity(startupConfig.database.url),
	});
	await writeFile(stagedConfigPath, stringify(startupConfig), {
		mode: 0o600,
		flag: "wx",
	});

	const seedResult = await seedDatabase({
		database: startupConfig.database,
		admin: resolved.admin,
		site: resolved.site,
		siteSettings: resolved.siteSettings,
		systemSettings: resolved.systemSettingSeeds,
		ipRegionUpdater: input.ipRegionUpdater,
	});
	updatePartialUpgradeMarker(markerPath, { currentStep: "database-completed" });
	const backupPath = await writeStartupConfig(
		input.minimalConfig.configPath,
		startupConfig,
		stagedConfigPath,
	);

	const lockPath = await writeInstallLock({
		configPath: input.minimalConfig.configPath,
		databasePath: "postgresql",
		adminConsolePath: resolved.admin.consolePath,
	});

	removePartialUpgradeMarker(markerPath);

	return {
		adminUrl: buildPublicUrl(
			startupConfig.server.publicBaseUrl,
			startupConfig.server.publicPath,
			resolved.admin.consolePath,
		),
		username: resolved.admin.username,
		initialPassword: resolved.admin.password,
		configPath: input.minimalConfig.configPath,
		databasePath: "postgresql",
		lockPath,
		backupPath,
		systemSettings: resolved.systemSettingSeeds.map((seed) => ({
			category: seed.category,
			key: seed.key,
			source: seed.source,
			envName: seed.envName,
			secret: seed.secret,
			valuePreview: seed.secret ? "configured" : previewValue(seed.value),
		})),
		ipRegionBootstrap: seedResult.ipRegionBootstrap,
		restartRequired: true,
	};
}

export async function inspectInstallDatabase(
	database: StartupConfig["database"],
): Promise<void> {
	const { pool, close } = createDatabaseClients(database.url, database);
	try {
		const result = await pool.query<{
			version: number;
			can_create: boolean;
			count: string;
		}>(
			`SELECT current_setting('server_version_num')::int AS version, has_schema_privilege(current_user, 'public', 'CREATE') AS can_create, (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f'))::text AS count`,
		);
		const state = result.rows[0];
		if (!state || state.version < 180000 || state.version >= 190000)
			throw new AppError(
				409,
				"DATABASE_VERSION_UNSUPPORTED",
				"请使用 PostgreSQL 18 数据库。",
			);
		if (!state.can_create)
			throw new AppError(
				403,
				"DATABASE_PERMISSION_DENIED",
				"请授予应用账号目标数据库 public schema 的创建权限。",
			);
		if (Number(state.count) > 0)
			throw new AppError(
				409,
				"DATABASE_TARGET_NOT_EMPTY",
				"目标数据库已有数据，请选择预建的空数据库。",
			);
	} catch (error) {
		if (error instanceof AppError) throw error;
		throw new AppError(
			503,
			classifyConnectionError(error).toUpperCase(),
			"数据库连接检查失败，请核对连接、账号和访问权限后重试。",
		);
	} finally {
		await close();
	}
}
