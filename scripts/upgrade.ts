import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

import { loadConfig, resolveConfigPath } from "../src/config/load-config";
import type { AppConfig } from "../src/config/types";
import { UpgradeService } from "../src/modules/upgrade/upgrade-service";

interface UpgradeCliOptions {
	configPath?: string;
	dryRun: boolean;
	apply: boolean;
	backupDirectory?: string;
	partialMarkerPath?: string;
}

function parseArgs(args: string[]): UpgradeCliOptions {
	const options: UpgradeCliOptions = { dryRun: false, apply: false };
	const readOptionValue = (index: number, name: string) => {
		const value = args[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`${name} requires a value.`);
		}
		return value;
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--dry-run") {
			options.dryRun = true;
		} else if (arg === "--apply") {
			options.apply = true;
		} else if (arg === "--config") {
			options.configPath = readOptionValue(index, "--config");
			index += 1;
		} else if (arg === "--backup-dir") {
			options.backupDirectory = readOptionValue(index, "--backup-dir");
			index += 1;
		} else if (arg === "--partial-marker") {
			options.partialMarkerPath = readOptionValue(index, "--partial-marker");
			index += 1;
		} else {
			throw new Error(`Unknown upgrade argument: ${arg}`);
		}
	}
	if (options.dryRun === options.apply) {
		throw new Error("Use exactly one of --dry-run or --apply.");
	}
	return options;
}

function readPackageVersion(): string {
	const packagePath = path.resolve(process.cwd(), "package.json");
	const packageJson = JSON.parse(readFileSync(packagePath, "utf-8")) as {
		version?: string;
	};
	return packageJson.version ?? "0.0.0";
}

export async function runUpgradeCli(
	args = process.argv.slice(2),
): Promise<number> {
	const options = parseArgs(args);
	const configPath = resolveConfigPath(options.configPath);
	let loadedConfig: AppConfig | undefined;
	let configError: unknown;
	try {
		loadedConfig = await loadConfig(configPath);
	} catch (error) {
		configError = error;
	}
	const databaseFile = loadedConfig
		? path.resolve(process.cwd(), loadedConfig.database.sqlite.file)
		: path.resolve(process.cwd(), "config", "qingyan.db");
	const service = new UpgradeService({
		configPath,
		loadedConfig,
		configError,
		databaseFile,
		createSqliteClient: (file) => new Database(file),
		currentApplicationVersion: readPackageVersion(),
		partialUpgradeMarkerPath:
			options.partialMarkerPath ??
			path.join(path.dirname(databaseFile), "upgrade", "partial-upgrade.json"),
	});
	const state = service.publicState();

	if (state.state !== "upgrade_required") {
		console.log(JSON.stringify({ state: state.state }, null, 2));
		return state.state === "broken_config" ||
			state.state === "recovery_required"
			? 1
			: 0;
	}
	if (options.dryRun) {
		console.log(JSON.stringify(state.plan, null, 2));
		return 0;
	}
	if (!options.backupDirectory) {
		throw new Error(
			"--apply requires --backup-dir before writing upgrade ledger.",
		);
	}
	const result = await service.apply({
		confirm: "UPGRADE QINGYAN",
		backupDirectory: options.backupDirectory,
	});
	console.log(JSON.stringify(result, null, 2));
	return 0;
}

if (require.main === module) {
	runUpgradeCli().then((exitCode) => {
		process.exitCode = exitCode;
	});
}
