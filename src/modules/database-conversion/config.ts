import {
	copyFile,
	mkdir,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parse, parseDocument } from "yaml";
import { configSchema } from "../../config/types";
import { checksum, type SqliteSource, writeProtectedJson } from "./source";

export interface ConfigPreparation {
	sourceConfigChecksum: string;
	generatedConfigChecksum: string;
	environmentReferences: string[];
	resources: Array<{
		source: string;
		archive: string | null;
		checksum: string | null;
		available: boolean;
	}>;
	readyForConfigSwitch: boolean;
}

export async function readLegacyConfig(configPath: string) {
	const text = await readFile(configPath, "utf8");
	const config = parse(text) as Record<string, unknown>;
	const database = config.database as
		| { client?: string; sqlite?: { file?: string } }
		| undefined;
	if (
		database?.client !== "sqlite" ||
		typeof database.sqlite?.file !== "string"
	)
		throw new Error("SOURCE_CONFIG_NOT_SQLITE");
	const admin = config.admin as
		| {
				auth?: { username?: string; passwordHash?: string };
				console?: { path?: string };
		  }
		| undefined;
	return {
		text,
		config,
		overrides: {
			username: admin?.auth?.username,
			passwordHash: admin?.auth?.passwordHash,
			consolePath: admin?.console?.path,
		},
	};
}

export async function prepareConfiguration(options: {
	configPath: string;
	sourceRoot?: string;
	sourceRuntimeRoot?: string;
	databaseUrl: string;
	outputDirectory: string;
	source: SqliteSource;
}): Promise<ConfigPreparation> {
	const legacy = await readLegacyConfig(options.configPath);
	if (
		path.resolve(options.configPath) !==
		path.resolve(options.outputDirectory, "source-config.yml")
	) {
		await copyFile(
			options.configPath,
			path.join(options.outputDirectory, "source-config.yml"),
		);
	}
	const document = parseDocument(legacy.text);
	document.set("database", {
		url: options.databaseUrl,
		pool: { max: 5, connectionTimeoutMs: 5000, idleTimeoutMs: 30000 },
	});
	const admin = legacy.config.admin as Record<string, unknown>;
	// 凭据和入口已迁到数据库，启动文件只保留现有 session owner。
	document.set("admin", { session: admin.session });
	const generated = document.toString();
	configSchema.parse(parse(generated));
	const generatedPath = path.join(options.outputDirectory, "target-config.yml");
	await writeFile(generatedPath, generated, { mode: 0o600 });
	const paths = new Set(
		options.source
			.rows("ip_region_database_state")
			.map((row) => row.file_path)
			.filter((value): value is string => typeof value === "string"),
	);
	for (const row of options.source.database
		.prepare(
			"SELECT value_json FROM system_settings WHERE category = 'ipRegion' AND key IN ('ipv4.dbPath', 'ipv6.dbPath')",
		)
		.all()) {
		const value = JSON.parse(String(row.value_json));
		if (typeof value === "string" && value) paths.add(value);
	}
	const resources: ConfigPreparation["resources"] = [];
	for (const resource of paths) {
		let available = false;
		let archive: string | null = null;
		let hash: string | null = null;
		if (options.sourceRoot) {
			const runtimeRoot = options.sourceRuntimeRoot
				?.replaceAll("\\", "/")
				.replace(/\/$/, "");
			const localResource =
				runtimeRoot && resource.startsWith(`${runtimeRoot}/`)
					? resource.slice(runtimeRoot.length + 1)
					: resource;
			const resolved = path.resolve(options.sourceRoot, localResource);
			try {
				if ((await stat(resolved)).isFile()) {
					await mkdir(path.join(options.outputDirectory, "resources"), {
						recursive: true,
						mode: 0o700,
					});
					archive = `resources/${resources.length}-${path.basename(resolved)}`;
					await copyFile(resolved, path.join(options.outputDirectory, archive));
					hash = await checksum(path.join(options.outputDirectory, archive));
					available = true;
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
		resources.push({ source: resource, archive, checksum: hash, available });
	}
	const preparation: ConfigPreparation = {
		sourceConfigChecksum: await checksum(
			path.join(options.outputDirectory, "source-config.yml"),
		),
		generatedConfigChecksum: await checksum(generatedPath),
		environmentReferences: [
			...new Set(
				(legacy.text.match(/\$\{[A-Z][A-Z0-9_]*(?::[^}]*)?\}/g) ?? []).map(
					(reference) => reference.slice(2).split(/[:}]/)[0],
				),
			),
		],
		resources,
		readyForConfigSwitch: resources.every((resource) => resource.available),
	};
	await writeProtectedJson(
		path.join(options.outputDirectory, "configuration.json"),
		preparation,
	);
	return preparation;
}

/** 配置切换是单独显式入口；先备份精确目标，再在同目录原子替换。 */
export async function applyPreparedConfiguration(options: {
	outputDirectory: string;
	destination: string;
	expectedDestinationChecksum: string;
}) {
	const preparation = JSON.parse(
		await readFile(
			path.join(options.outputDirectory, "configuration.json"),
			"utf8",
		),
	) as ConfigPreparation;
	if (!preparation.readyForConfigSwitch)
		throw new Error("SOURCE_RESOURCES_NOT_ARCHIVED");
	const destinationChecksum = await checksum(options.destination);
	if (
		destinationChecksum !== options.expectedDestinationChecksum &&
		destinationChecksum !== preparation.generatedConfigChecksum
	)
		throw new Error("CONFIG_DESTINATION_CHANGED");
	const targetPath = path.join(options.outputDirectory, "target-config.yml");
	if ((await checksum(targetPath)) !== preparation.generatedConfigChecksum)
		throw new Error("PREPARED_CONFIG_CHANGED");
	const backupPath = path.join(options.outputDirectory, "previous-config.yml");
	if (destinationChecksum === preparation.generatedConfigChecksum) {
		if ((await checksum(backupPath)) !== options.expectedDestinationChecksum)
			throw new Error("CONFIG_PREVIOUS_BACKUP_CHANGED");
		return { switched: true, backup: "previous-config.yml" };
	}
	await copyFile(options.destination, backupPath);
	const staged = `${options.destination}.sqlite-conversion-staged`;
	try {
		await writeFile(staged, await readFile(targetPath), {
			mode: 0o600,
			flag: "wx",
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		if ((await checksum(staged)) !== preparation.generatedConfigChecksum)
			throw new Error("CONFIG_STAGED_FILE_CHANGED");
	}
	await rename(staged, options.destination);
	return { switched: true, backup: "previous-config.yml" };
}
