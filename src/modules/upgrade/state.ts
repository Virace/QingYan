import { existsSync } from "node:fs";

import type { AppConfig } from "../../config/types";
import type { SqliteClient } from "../../db/client";
import type {
	UpgradeApplicationStep,
	UpgradeMigrationStep,
	UpgradePlan,
} from "./upgrade-plan";

export type UpgradeRuntimeState =
	| { state: "not_installed" }
	| { state: "normal_current" }
	| { state: "upgrade_required"; plan: UpgradePlan }
	| { state: "recovery_required"; reason: string }
	| { state: "broken_config"; reason: string };

export interface UpgradeDetectorInput {
	configPath: string;
	loadedConfig?: AppConfig;
	configError?: unknown;
	databaseFile: string;
	createSqliteClient: (databaseFile: string) => SqliteClient;
	currentApplicationVersion: string;
	partialUpgradeMarkerPath?: string;
	requiredApplicationUpgrades?: UpgradeApplicationStep[];
}

function tableExists(sqlite: SqliteClient, tableName: string): boolean {
	return Boolean(
		sqlite
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
			)
			.get(tableName),
	);
}

function countRows(sqlite: SqliteClient, tableName: string): number {
	return Number(
		(
			sqlite.prepare(`SELECT count(*) AS value FROM ${tableName}`).get() as {
				value?: number;
			}
		)?.value ?? 0,
	);
}

function appliedUpgradeNames(sqlite: SqliteClient): Set<string> {
	if (!tableExists(sqlite, "__qingyan_upgrades")) {
		return new Set();
	}
	const rows = sqlite
		.prepare("SELECT name FROM __qingyan_upgrades")
		.all() as Array<{ name: string }>;
	return new Set(rows.map((row) => row.name));
}

function latestUpgradeVersion(sqlite: SqliteClient): string | undefined {
	if (!tableExists(sqlite, "__qingyan_upgrades")) {
		return undefined;
	}
	const row = sqlite
		.prepare(
			"SELECT to_version FROM __qingyan_upgrades ORDER BY applied_at DESC",
		)
		.get() as { to_version?: string } | undefined;
	return row?.to_version;
}

function missingUpgradeSteps(
	sqlite: SqliteClient,
	requiredSteps: UpgradeApplicationStep[] = [],
): UpgradeApplicationStep[] {
	const applied = appliedUpgradeNames(sqlite);
	return requiredSteps.filter((step) => !applied.has(step.name));
}

function createPlan(
	input: UpgradeDetectorInput,
	applicationUpgrades: UpgradeApplicationStep[],
	schemaMigrations: UpgradeMigrationStep[] = [],
): UpgradePlan {
	return {
		currentVersion: "unknown",
		targetVersion: input.currentApplicationVersion,
		schemaMigrations,
		applicationUpgrades,
		configChanges: [],
		dbSettingChanges: [],
		secretHandling: [],
		backupPaths: {},
		risks: ["Upgrade must be confirmed before starting the normal app."],
	};
}

function requiresVersionCatchup(
	sqlite: SqliteClient,
	currentApplicationVersion: string,
): UpgradeApplicationStep | undefined {
	const latestVersion = latestUpgradeVersion(sqlite);
	if (!latestVersion || latestVersion === currentApplicationVersion) {
		return undefined;
	}
	return {
		name: `application-version:${currentApplicationVersion}`,
		fromVersion: latestVersion,
		toVersion: currentApplicationVersion,
		summary: { reason: "application_upgrade_ledger_behind" },
	};
}

function classifyDatabase(
	sqlite: SqliteClient,
	input: UpgradeDetectorInput,
): UpgradeRuntimeState {
	if (!tableExists(sqlite, "__qingyan_migrations")) {
		return {
			state: "upgrade_required",
			plan: createPlan(
				input,
				[],
				[
					{
						name: "schema-migration-ledger",
						description: "Create migration ledger",
					},
				],
			),
		};
	}
	if (!tableExists(sqlite, "__qingyan_upgrades")) {
		return {
			state: "upgrade_required",
			plan: createPlan(input, [
				{
					name: "application-upgrade-ledger",
					toVersion: input.currentApplicationVersion,
				},
			]),
		};
	}
	if (
		!tableExists(sqlite, "admin_bootstrap_state") ||
		!tableExists(sqlite, "sites")
	) {
		return { state: "not_installed" };
	}
	if (
		countRows(sqlite, "admin_bootstrap_state") === 0 ||
		countRows(sqlite, "sites") === 0
	) {
		return { state: "not_installed" };
	}

	const versionStep = requiresVersionCatchup(
		sqlite,
		input.currentApplicationVersion,
	);
	const missingSteps = missingUpgradeSteps(
		sqlite,
		input.requiredApplicationUpgrades,
	);
	const steps = [...(versionStep ? [versionStep] : []), ...missingSteps];
	return steps.length > 0
		? { state: "upgrade_required", plan: createPlan(input, steps) }
		: { state: "normal_current" };
}

export function detectUpgradeRuntimeState(
	input: UpgradeDetectorInput,
): UpgradeRuntimeState {
	if (
		!existsSync(input.configPath) &&
		!input.loadedConfig &&
		!input.configError
	) {
		return { state: "not_installed" };
	}
	if (input.configError) {
		return {
			state: "broken_config",
			reason:
				input.configError instanceof Error
					? input.configError.message
					: String(input.configError),
		};
	}
	if (
		input.partialUpgradeMarkerPath &&
		existsSync(input.partialUpgradeMarkerPath)
	) {
		return { state: "recovery_required", reason: "partial_upgrade_marker" };
	}
	if (!input.loadedConfig || !existsSync(input.databaseFile)) {
		return { state: "not_installed" };
	}

	const sqlite = input.createSqliteClient(input.databaseFile);
	try {
		return classifyDatabase(sqlite, input);
	} finally {
		sqlite.close();
	}
}
