import { randomUUID } from "node:crypto";
import path from "node:path";

import { DatabaseBackupService } from "../database-backup/database-backup-service";
import type { AppConfig } from "../../config/types";
import type { SqliteClient } from "../../db/client";
import { applyDatabaseMigrations } from "../../db/migrations";
import { detectUpgradeRuntimeState, type UpgradeRuntimeState } from "./state";
import {
	toPublicUpgradePlan,
	type UpgradeApplicationStep,
} from "./upgrade-plan";
import {
	removePartialUpgradeMarker,
	updatePartialUpgradeMarker,
	writePartialUpgradeMarker,
} from "./partial-marker";

const UPGRADE_CONFIRMATION = "UPGRADE QINGYAN";

export interface UpgradeContext {
	sqlite: SqliteClient;
	config: AppConfig;
	databaseFile: string;
}

export interface RegisteredApplicationUpgrade {
	name: string;
	fromVersion?: string;
	toVersion: string;
	describe(input: UpgradeContext): UpgradeApplicationStep;
	apply(input: UpgradeContext): void | Promise<void>;
}

export interface UpgradeApplyResult {
	state: "applied";
	backup: Awaited<ReturnType<DatabaseBackupService["createUpgradeBackup"]>>;
	applied: {
		schemaMigrations: string[];
		applicationUpgrades: string[];
	};
	restartRequired: true;
}

export interface UpgradeServiceOptions {
	configPath: string;
	loadedConfig?: AppConfig;
	configError?: unknown;
	databaseFile: string;
	currentApplicationVersion: string;
	partialUpgradeMarkerPath: string;
	createSqliteClient: (databaseFile: string) => SqliteClient;
	registeredApplicationUpgrades?: RegisteredApplicationUpgrade[];
	backupDirectory?: string;
	migrationDirectory?: string;
	now?: () => Date;
}

function displayPath(filePath: string) {
	const relative = path.relative(process.cwd(), filePath);
	return relative.startsWith("..") ? filePath : relative;
}

function upgradeId(now: Date) {
	const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
	return `upgrade_${stamp}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

function writeAppliedUpgrades(
	sqlite: SqliteClient,
	steps: UpgradeApplicationStep[],
	targetVersion: string,
) {
	const insert = sqlite.prepare(`
		INSERT OR REPLACE INTO __qingyan_upgrades
			(name, from_version, to_version, summary_json)
		VALUES (?, ?, ?, ?)
	`);
	for (const step of steps) {
		insert.run(
			step.name,
			step.fromVersion ?? null,
			step.toVersion ?? targetVersion,
			JSON.stringify(step.summary ?? {}),
		);
	}
}

export class UpgradeService {
	public constructor(private readonly options: UpgradeServiceOptions) {}

	public detect(): UpgradeRuntimeState {
		const sqlite = this.options.loadedConfig
			? this.options.createSqliteClient(this.options.databaseFile)
			: undefined;
		try {
			const context =
				sqlite && this.options.loadedConfig
					? {
							sqlite,
							config: this.options.loadedConfig,
							databaseFile: this.options.databaseFile,
						}
					: undefined;
			return detectUpgradeRuntimeState({
				configPath: this.options.configPath,
				loadedConfig: this.options.loadedConfig,
				configError: this.options.configError,
				databaseFile: this.options.databaseFile,
				createSqliteClient: this.options.createSqliteClient,
				currentApplicationVersion: this.options.currentApplicationVersion,
				partialUpgradeMarkerPath: this.options.partialUpgradeMarkerPath,
				requiredApplicationUpgrades: context
					? this.options.registeredApplicationUpgrades?.map((step) =>
							step.describe(context),
						)
					: undefined,
			});
		} finally {
			sqlite?.close();
		}
	}

	public publicState(): UpgradeRuntimeState {
		const state = this.detect();
		if (state.state !== "upgrade_required") {
			return state;
		}
		return {
			state: "upgrade_required",
			plan: toPublicUpgradePlan(state.plan),
		};
	}

	public async apply(input: {
		confirm: string;
		backupDirectory?: string;
	}): Promise<UpgradeApplyResult> {
		if (input.confirm !== UPGRADE_CONFIRMATION) {
			throw new Error("UPGRADE_CONFIRMATION_REQUIRED");
		}
		if (!this.options.loadedConfig) {
			throw new Error("UPGRADE_CONFIG_REQUIRED");
		}

		const state = this.detect();
		if (state.state !== "upgrade_required") {
			throw new Error(`UPGRADE_STATE_INVALID:${state.state}`);
		}

		const now = this.options.now?.() ?? new Date();
		const id = upgradeId(now);
		const backupDirectory =
			input.backupDirectory ??
			this.options.backupDirectory ??
			path.join(
				path.dirname(this.options.databaseFile),
				"backups",
				"upgrades",
				id,
			);
		const planPath = path.join(backupDirectory, "upgrade-plan.json");
		writePartialUpgradeMarker({
			markerPath: this.options.partialUpgradeMarkerPath,
			fromVersion: state.plan.currentVersion,
			toVersion: state.plan.targetVersion,
			planPath: displayPath(planPath),
			backupDirectory: displayPath(backupDirectory),
			currentStep: "backup",
			now: () => now,
		});

		const sqlite = this.options.createSqliteClient(this.options.databaseFile);
		try {
			const backupService = new DatabaseBackupService({
				engine: this.options.loadedConfig.database.client,
				databaseFile: this.options.databaseFile,
				sqlite,
				now: () => now,
			});
			const backup = await backupService.createUpgradeBackup({
				upgradeId: id,
				fromVersion: state.plan.currentVersion,
				toVersion: state.plan.targetVersion,
				configPath: this.options.configPath,
				plan: toPublicUpgradePlan(state.plan),
				partialMarkerPath: this.options.partialUpgradeMarkerPath,
				backupDirectory,
			});

			updatePartialUpgradeMarker(this.options.partialUpgradeMarkerPath, {
				currentStep: "schema-migrations",
			});
			applyDatabaseMigrations(sqlite, this.options.migrationDirectory);

			updatePartialUpgradeMarker(this.options.partialUpgradeMarkerPath, {
				currentStep: "application-upgrades",
			});
			const context: UpgradeContext = {
				sqlite,
				config: this.options.loadedConfig,
				databaseFile: this.options.databaseFile,
			};
			const registered = new Map(
				this.options.registeredApplicationUpgrades?.map((step) => [
					step.name,
					step,
				]) ?? [],
			);
			for (const step of state.plan.applicationUpgrades) {
				await registered.get(step.name)?.apply(context);
			}

			updatePartialUpgradeMarker(this.options.partialUpgradeMarkerPath, {
				currentStep: "upgrade-ledger",
			});
			const applyLedger = sqlite.transaction(() => {
				writeAppliedUpgrades(
					sqlite,
					state.plan.applicationUpgrades,
					state.plan.targetVersion,
				);
			});
			applyLedger();
			removePartialUpgradeMarker(this.options.partialUpgradeMarkerPath);

			return {
				state: "applied",
				backup,
				applied: {
					schemaMigrations: state.plan.schemaMigrations.map(
						(step) => step.name,
					),
					applicationUpgrades: state.plan.applicationUpgrades.map(
						(step) => step.name,
					),
				},
				restartRequired: true,
			};
		} catch (error) {
			updatePartialUpgradeMarker(this.options.partialUpgradeMarkerPath, {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			sqlite.close();
		}
	}
}
