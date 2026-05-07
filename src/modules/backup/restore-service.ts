import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const manifestSchema = z.object({
	format: z.literal("qingyan.full-backup"),
	formatVersion: z.literal(1),
	qingyanVersion: z.string().min(1),
	database: z.object({
		client: z.string().min(1),
	}),
	config: z.object({
		path: z.string().min(1),
	}),
	files: z.array(
		z.object({
			path: z.string().min(1),
			role: z.string().min(1),
		}),
	),
});

export interface RestorePlan {
	backupVersion: string;
	currentVersion: string;
	databaseClient: string;
	configPath: string;
	upgradeRequired: boolean;
	backupRoot: string;
}

export class RestoreService {
	public constructor(
		private readonly options: {
			currentVersion: string;
			currentConfigPath: string;
		},
	) {}

	public plan(input: { backupPath: string }): RestorePlan {
		const manifestPath = input.backupPath.endsWith("manifest.json")
			? input.backupPath
			: path.join(input.backupPath, "manifest.json");
		const parsed = manifestSchema.parse(
			JSON.parse(readFileSync(manifestPath, "utf-8")) as unknown,
		);

		return {
			backupVersion: parsed.qingyanVersion,
			currentVersion: this.options.currentVersion,
			databaseClient: parsed.database.client,
			configPath: this.options.currentConfigPath,
			upgradeRequired: parsed.qingyanVersion !== this.options.currentVersion,
			backupRoot: path.dirname(manifestPath),
		};
	}
}
