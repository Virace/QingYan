import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, rename } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { loadConfig } from "../../config/load-config";
import type { AppConfig } from "../../config/types";
import { createDatabaseClients, type DatabaseExecutor } from "../../db/client";
import { applyDatabaseMigrations } from "../../db/migrations";
import { readAdminInfo } from "../admin/bootstrap-admin-ops";
import { DatabaseBackupService } from "../database-backup/database-backup-service";
import { databaseIdentity } from "../database-backup/postgres-tools";
import { writeInstallLock } from "../install/state";
import {
	readPartialUpgradeMarker,
	removePartialUpgradeMarker,
	updatePartialUpgradeMarker,
	writePartialUpgradeMarker,
} from "./partial-marker";
import { detectUpgradeRuntimeState, type UpgradeRuntimeState } from "./state";
import {
	toPublicUpgradePlan,
	type UpgradeApplicationStep,
} from "./upgrade-plan";
export interface UpgradeContext {
	db: DatabaseExecutor;
	config: AppConfig;
	databaseUrl: string;
}
export interface RegisteredApplicationUpgrade {
	name: string;
	fromVersion?: string;
	toVersion: string;
	describe(input: UpgradeContext): UpgradeApplicationStep;
	apply(input: UpgradeContext): void | Promise<void>;
}
export interface UpgradeServiceOptions {
	configPath: string;
	loadedConfig?: AppConfig;
	configError?: unknown;
	currentApplicationVersion: string;
	partialUpgradeMarkerPath: string;
	registeredApplicationUpgrades?: RegisteredApplicationUpgrade[];
	backupDirectory?: string;
	migrationDirectory?: string;
	now?: () => Date;
}
export interface UpgradeApplyResult {
	state: "applied";
	backup: Awaited<ReturnType<DatabaseBackupService["createUpgradeBackup"]>>;
	applied: { schemaMigrations: string[]; applicationUpgrades: string[] };
	restartRequired: true;
}
export class UpgradeService {
	constructor(private readonly options: UpgradeServiceOptions) {}
	async detect(): Promise<UpgradeRuntimeState> {
		const config = this.options.loadedConfig;
		if (!config) return detectUpgradeRuntimeState(this.options);
		const clients = createDatabaseClients(config.database.url, config.database);
		try {
			return await detectUpgradeRuntimeState({
				...this.options,
				requiredApplicationUpgrades:
					this.options.registeredApplicationUpgrades?.map((step) =>
						step.describe({
							db: clients.db,
							config,
							databaseUrl: config.database.url,
						}),
					),
			});
		} finally {
			await clients.close();
		}
	}
	async publicState(): Promise<UpgradeRuntimeState> {
		const state = await this.detect();
		return state.state === "upgrade_required"
			? { ...state, plan: toPublicUpgradePlan(state.plan) }
			: state;
	}
	async recover(input: { confirm: string }): Promise<void> {
		if (input.confirm !== "UPGRADE QINGYAN")
			throw new Error("UPGRADE_CONFIRMATION_REQUIRED");
		const marker = readPartialUpgradeMarker(
			this.options.partialUpgradeMarkerPath,
		);
		if (
			!marker ||
			![
				"database-completed",
				"schema-migrations",
				"application-upgrades",
				"install-database",
			].includes(marker.currentStep)
		)
			throw new Error("UPGRADE_RECOVERY_REQUIRES_RESTORE");
		const config =
			marker.stagedConfigPath && existsSync(marker.stagedConfigPath)
				? await loadConfig(marker.stagedConfigPath)
				: this.options.loadedConfig;
		if (
			!config ||
			marker.targetIdentity !== databaseIdentity(config.database.url) ||
			marker.toVersion !== this.options.currentApplicationVersion
		)
			throw new Error("UPGRADE_RECOVERY_TARGET_MISMATCH");

		const clients = createDatabaseClients(config.database.url, config.database);
		let requiredApplicationUpgrades: UpgradeApplicationStep[] | undefined;
		try {
			requiredApplicationUpgrades =
				this.options.registeredApplicationUpgrades?.map((step) =>
					step.describe({
						db: clients.db,
						config,
						databaseUrl: config.database.url,
					}),
				);
		} finally {
			await clients.close();
		}

		const state = await detectUpgradeRuntimeState({
			...this.options,
			loadedConfig: config,
			configError: undefined,
			requiredApplicationUpgrades,
			partialUpgradeMarkerPath: undefined,
		});
		if (state.state !== "normal_current")
			throw new Error("UPGRADE_RECOVERY_DATABASE_NOT_CURRENT");
		if (marker.stagedConfigPath && existsSync(marker.stagedConfigPath)) {
			if (existsSync(this.options.configPath))
				await copyFile(
					this.options.configPath,
					`${this.options.configPath}.before-recovery-${Date.now()}`,
				);
			await rename(marker.stagedConfigPath, this.options.configPath);
			const clients = createDatabaseClients(
				config.database.url,
				config.database,
			);
			try {
				const admin = await readAdminInfo(clients.db);
				if (!admin) throw new Error("ADMIN_BOOTSTRAP_NOT_FOUND");
				await writeInstallLock({
					configPath: this.options.configPath,
					databasePath: "postgresql",
					adminConsolePath: admin.consolePath,
				});
			} finally {
				await clients.close();
			}
		}

		removePartialUpgradeMarker(this.options.partialUpgradeMarkerPath);
	}
	async apply(input: {
		confirm: string;
		backupDirectory?: string;
	}): Promise<UpgradeApplyResult> {
		if (input.confirm !== "UPGRADE QINGYAN")
			throw new Error("UPGRADE_CONFIRMATION_REQUIRED");
		const config = this.options.loadedConfig;
		if (!config) throw new Error("UPGRADE_CONFIG_REQUIRED");
		const state = await this.detect();
		if (state.state !== "upgrade_required")
			throw new Error(`UPGRADE_STATE_INVALID:${state.state}`);
		const now = this.options.now?.() ?? new Date();
		const id = `upgrade_${now.toISOString().replace(/\D/g, "")}_${randomUUID().slice(0, 8)}`;
		const backupDirectory = path.resolve(
			input.backupDirectory ??
				this.options.backupDirectory ??
				path.join("data/backups/upgrades", id),
		);
		state.plan.backupPaths = {
			database: path.join(backupDirectory, "database/qingyan.dump"),
			config: path.join(backupDirectory, "config/qingyan.yml"),
			plan: path.join(backupDirectory, "upgrade-plan.json"),
		};
		state.plan.risks.push(
			"恢复使用 qyctl restore，把 custom dump 恢复到预建空数据库后单独切换配置；数据库角色由 PostgreSQL 运维管理。",
		);

		writePartialUpgradeMarker({
			markerPath: this.options.partialUpgradeMarkerPath,
			fromVersion: state.plan.currentVersion,
			toVersion: state.plan.targetVersion,
			planPath: path.join(backupDirectory, "upgrade-plan.json"),
			backupDirectory,
			currentStep: "backup",
			targetIdentity: databaseIdentity(config.database.url),
			now: () => now,
		});
		const clients = createDatabaseClients(config.database.url, config.database);
		try {
			const backup = await new DatabaseBackupService({
				database: config.database,
				config,
				now: () => now,
			}).createUpgradeBackup({
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
			await applyDatabaseMigrations(
				clients.pool,
				this.options.migrationDirectory,
			);
			updatePartialUpgradeMarker(this.options.partialUpgradeMarkerPath, {
				currentStep: "application-upgrades",
			});
			const registered = new Map(
				this.options.registeredApplicationUpgrades?.map((step) => [
					step.name,
					step,
				]),
			);
			await clients.db.transaction(async (tx) => {
				for (const step of state.plan.applicationUpgrades) {
					await registered
						.get(step.name)
						?.apply({ db: tx, config, databaseUrl: config.database.url });
					await tx.execute(
						sql`INSERT INTO __qingyan_upgrades(name,from_version,to_version,summary_json) VALUES(${step.name},${step.fromVersion ?? null},${step.toVersion ?? state.plan.targetVersion},${JSON.stringify(step.summary ?? {})}::jsonb) ON CONFLICT(name) DO NOTHING`,
					);
				}
			});
			updatePartialUpgradeMarker(this.options.partialUpgradeMarkerPath, {
				currentStep: "database-completed",
			});
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
				error: "UPGRADE_FAILED",
			});
			throw error;
		} finally {
			await clients.close();
		}
	}
}
