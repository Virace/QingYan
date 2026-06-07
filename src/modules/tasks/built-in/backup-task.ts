import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { QingYanExportService } from "../../import-export/qingyan/export-service";
import type { FullBackupService } from "../../backup/full-backup-service";
import type { TaskRunnerContext } from "../task-runner-context";

export const backupPayloadSchema = z
	.object({
		scope: z.enum(["site", "full"]).default("site"),
		siteKey: z.string().min(1).optional(),
		include: z
			.object({
				siteSettings: z.boolean().optional(),
				systemSettings: z.boolean().optional(),
				pageThreads: z.boolean().optional(),
				comments: z.boolean().optional(),
				rawUserAgent: z.boolean().optional(),
				visitors: z.boolean().optional(),
				voteRecords: z.boolean().optional(),
				pageFeedbackRecords: z.boolean().optional(),
				blacklistRules: z.boolean().optional(),
			})
			.optional(),
		retentionCount: z.number().int().min(1).max(30).optional(),
	})
	.strict();

export type BackupTaskPayload = z.infer<typeof backupPayloadSchema>;

export interface BackupTaskService {
	createBackup(input: BackupTaskPayload & { runId: string }): Promise<unknown>;
}

function defaultOutputDirectory() {
	return path.resolve(process.cwd(), "data", "task-backups");
}

function sha256File(filePath: string) {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export class DefaultBackupTaskService implements BackupTaskService {
	public constructor(
		private readonly services: {
			exportService: QingYanExportService;
			fullBackupService?: FullBackupService;
		},
	) {}

	public async createBackup(input: BackupTaskPayload & { runId: string }) {
		if (input.scope === "full") {
			if (!this.services.fullBackupService) {
				throw new Error("FULL_BACKUP_SERVICE_NOT_CONFIGURED");
			}
			const result = await this.services.fullBackupService.createBackup({
				outputPath: path.join(defaultOutputDirectory(), `${input.runId}-full`),
			});
			const manifestStat = statSync(result.manifestPath);
			return {
				scope: "full",
				fileName: path.basename(result.outputDirectory),
				path: result.outputDirectory,
				size: manifestStat.size,
				hash: sha256File(result.manifestPath),
				createdAt: result.manifest.createdAt,
			};
		}

		if (!input.siteKey) {
			throw new Error("SITE_KEY_REQUIRED");
		}
		const outputDirectory = defaultOutputDirectory();
		mkdirSync(outputDirectory, { recursive: true });
		const data = this.services.exportService.exportSite({
			siteKey: input.siteKey,
			include: input.include,
		});
		const fileName = `${input.runId}-${input.siteKey}.qingyan-export.json`;
		const filePath = path.join(outputDirectory, fileName);
		writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
		const stat = statSync(filePath);
		return {
			scope: "site",
			siteKey: input.siteKey,
			fileName,
			path: filePath,
			size: stat.size,
			hash: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
			createdAt: data.createdAt,
			include: input.include ?? {},
			retentionCount: input.retentionCount ?? null,
		};
	}
}

export async function runBackupTask(
	payload: BackupTaskPayload,
	context: TaskRunnerContext,
) {
	const service = context.services.backup;
	if (!service) {
		throw new Error("Task service missing: backup");
	}
	await context.writeEvent({
		eventType: "backup_precondition_checked",
		message: "backup_precondition_checked",
		data: { scope: payload.scope, siteKey: payload.siteKey ?? null },
	});
	return service.createBackup({ ...payload, runId: context.runId });
}
