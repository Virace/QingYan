import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
	toPublicUpgradePlan,
	type UpgradeBackupPaths,
	type UpgradePlan,
} from "./upgrade-plan";

export interface UpgradeBackupInput {
	configPath: string;
	databaseFile: string;
	plan: UpgradePlan;
	backupDirectory?: string;
	now?: Date;
}

function timestamp(now = new Date()): string {
	return now.toISOString().replace(/[:.]/g, "-");
}

function targetPath(
	sourcePath: string,
	backupDirectory: string | undefined,
	now: Date,
): string {
	const directory = backupDirectory ?? path.dirname(sourcePath);
	mkdirSync(directory, { recursive: true });
	return path.join(
		directory,
		`${path.basename(sourcePath)}.bak-${timestamp(now)}`,
	);
}

function copyIfExists(sourcePath: string, target: string): string | undefined {
	if (!existsSync(sourcePath)) {
		return undefined;
	}
	copyFileSync(sourcePath, target);
	return target;
}

export function createUpgradeBackups(
	input: UpgradeBackupInput,
): UpgradeBackupPaths {
	const now = input.now ?? new Date();
	const backupPaths: UpgradeBackupPaths = {};
	backupPaths.config = copyIfExists(
		input.configPath,
		targetPath(input.configPath, input.backupDirectory, now),
	);
	backupPaths.database = copyIfExists(
		input.databaseFile,
		targetPath(input.databaseFile, input.backupDirectory, now),
	);
	backupPaths.sqliteWal = copyIfExists(
		`${input.databaseFile}-wal`,
		targetPath(`${input.databaseFile}-wal`, input.backupDirectory, now),
	);
	backupPaths.sqliteShm = copyIfExists(
		`${input.databaseFile}-shm`,
		targetPath(`${input.databaseFile}-shm`, input.backupDirectory, now),
	);

	const planPath = path.join(
		input.backupDirectory ?? path.dirname(input.configPath),
		`upgrade-plan.json.bak-${timestamp(now)}`,
	);
	mkdirSync(path.dirname(planPath), { recursive: true });
	writeFileSync(
		planPath,
		`${JSON.stringify(toPublicUpgradePlan(input.plan), null, 2)}\n`,
		"utf-8",
	);
	backupPaths.plan = planPath;
	return backupPaths;
}
