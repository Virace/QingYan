import type { StartupConfig } from "../../config/types";
import { DatabaseBackupService } from "../database-backup/database-backup-service";
import { toPublicUpgradePlan, type UpgradePlan } from "./upgrade-plan";
export async function createUpgradeBackups(input: {
	configPath: string;
	database: StartupConfig["database"];
	plan: UpgradePlan;
	backupDirectory: string;
	now?: Date;
}) {
	return new DatabaseBackupService({
		database: input.database,
		now: () => input.now ?? new Date(),
	}).createUpgradeBackup({
		upgradeId: "manual",
		fromVersion: input.plan.currentVersion,
		toVersion: input.plan.targetVersion,
		configPath: input.configPath,
		plan: toPublicUpgradePlan(input.plan),
		partialMarkerPath: "",
		backupDirectory: input.backupDirectory,
	});
}
