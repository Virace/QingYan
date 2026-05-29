#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

import type { AppConfig } from "../config/types";
import { DatabaseBackupService } from "../modules/database-backup/database-backup-service";
import {
	readAdminInfo,
	resetAdminEntrance,
	resetAdminPasswordWithGenerated,
} from "../modules/admin/bootstrap-admin-ops";
import { QingYanExportService } from "../modules/import-export/qingyan/export-service";
import { QingYanImportService } from "../modules/import-export/qingyan/import-service";
import { SystemdServiceController } from "../modules/service-control/systemd-service";
import { UpgradeService } from "../modules/upgrade/upgrade-service";
import { FullBackupService } from "../modules/backup/full-backup-service";
import { RestoreService } from "../modules/backup/restore-service";
import { GitHubReleaseClient } from "../modules/ops/github-release-client";
import { OpsStatusService } from "../modules/ops/ops-status-service";
import { PageRegistryService } from "../modules/page-registry/service";
import {
	type UpdateCheckService,
	type UpdateCheckState,
	UpdateCheckService as GitHubUpdateCheckService,
} from "../modules/ops/update-check-service";
import {
	openCliRuntime,
	readPackageVersion,
	resolveCliConfigPath,
} from "./runtime";

export interface CliOutput {
	stdout: string[];
	stderr: string[];
}

export interface CliDeps {
	openRuntime?: typeof openCliRuntime;
	service?: SystemdServiceController;
	output?: CliOutput;
	environment?: NodeJS.ProcessEnv;
	updateCheckService?: Pick<UpdateCheckService, "check">;
	updatePlanService?: Pick<OpsStatusService, "getUpdatePlan">;
}

interface ParsedArgs {
	positionals: string[];
	flags: Map<string, string | boolean>;
}

function parseArgs(args: string[]): ParsedArgs {
	const positionals: string[] = [];
	const flags = new Map<string, string | boolean>();
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] ?? "";
		if (!arg.startsWith("--")) {
			positionals.push(arg);
			continue;
		}
		const name = arg.slice(2);
		if (name === "yes" || name === "dry-run") {
			flags.set(name, true);
			continue;
		}
		const value = args[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`--${name} requires a value.`);
		}
		flags.set(name, value);
		index += 1;
	}
	return { positionals, flags };
}

function flagString(parsed: ParsedArgs, name: string): string | undefined {
	const value = parsed.flags.get(name);
	return typeof value === "string" ? value : undefined;
}

function hasFlag(parsed: ParsedArgs, name: string): boolean {
	return parsed.flags.get(name) === true;
}

function flagStrings(parsed: ParsedArgs, name: string): string[] {
	const value = parsed.flags.get(name);
	if (typeof value !== "string") {
		return [];
	}
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function publicAdminUrl(publicBaseUrl: string, consolePath: string): string {
	return new URL(consolePath, publicBaseUrl).toString();
}

function fullExportInclude() {
	return {
		siteSettings: true,
		systemSettings: true,
		pageThreads: true,
		comments: true,
		visitors: true,
		voteRecords: true,
		pageFeedbackRecords: true,
		blacklistRules: true,
	};
}

async function withRuntime<T>(
	parsed: ParsedArgs,
	deps: Required<CliDeps>,
	action: (runtime: Awaited<ReturnType<typeof openCliRuntime>>) => Promise<T>,
): Promise<T> {
	const runtime = await deps.openRuntime({
		configPath: flagString(parsed, "config"),
		environment: deps.environment,
	});
	try {
		return await action(runtime);
	} finally {
		runtime.close();
	}
}

async function commandInfo(
	parsed: ParsedArgs,
	deps: Required<CliDeps>,
): Promise<number> {
	await withRuntime(parsed, deps, async (runtime) => {
		const state = await deps.service.status().catch(() => "unknown" as const);
		const admin = await readAdminInfo(runtime.db);
		deps.output.stdout.push(`QingYan ${runtime.packageVersion}`);
		deps.output.stdout.push("");
		deps.output.stdout.push(
			`服务状态：${state === "running" ? "运行中" : state === "stopped" ? "未运行" : "未知"}`,
		);
		if (admin) {
			deps.output.stdout.push(
				`控制台入口：${publicAdminUrl(runtime.config.server.publicBaseUrl, admin.consolePath)}`,
			);
			deps.output.stdout.push(`管理员用户：${admin.username}`);
		} else {
			deps.output.stdout.push("控制台入口：未初始化");
			deps.output.stdout.push("管理员用户：未初始化");
		}
		deps.output.stdout.push(`配置文件：${runtime.configPath}`);
		deps.output.stdout.push(`数据库：SQLite / ${runtime.databaseFile}`);
		deps.output.stdout.push("数据状态：可读取");
	});
	return 0;
}

async function commandAdmin(
	parsed: ParsedArgs,
	deps: Required<CliDeps>,
): Promise<number> {
	const action = parsed.positionals[1];
	if (action !== "repass" && action !== "entrance") {
		throw new Error("Unknown admin command.");
	}
	await withRuntime(parsed, deps, async (runtime) => {
		await deps.service.runWithStoppedService(async () => {
			if (action === "repass") {
				const password = parsed.positionals[2];
				const result = await resetAdminPasswordWithGenerated(runtime.db, {
					password,
				});
				deps.output.stdout.push("管理员密码已重置。");
				deps.output.stdout.push(`用户名：${result.username}`);
				if (result.passwordGenerated && result.password) {
					deps.output.stdout.push(`新密码：${result.password}`);
					deps.output.stdout.push("请立即保存，新密码不会再次显示。");
				}
				return;
			}
			const result = await resetAdminEntrance(runtime.db, {
				path: parsed.positionals[2],
			});
			deps.output.stdout.push("后台入口已重置。");
			deps.output.stdout.push(
				`控制台入口：${publicAdminUrl(runtime.config.server.publicBaseUrl, result.consolePath)}`,
			);
		});
	});
	return 0;
}

async function commandService(
	command: string,
	deps: Required<CliDeps>,
): Promise<number> {
	if (command === "status") {
		const state = await deps.service.status();
		deps.output.stdout.push(
			state === "running" ? "服务状态：运行中" : "服务状态：未运行",
		);
		return 0;
	}
	if (command === "start") {
		await deps.service.start();
		deps.output.stdout.push("服务已启动。");
		return 0;
	}
	if (command === "stop") {
		await deps.service.stop();
		deps.output.stdout.push("服务已停止。");
		return 0;
	}
	if (command === "restart") {
		await deps.service.restart();
		deps.output.stdout.push("服务已重启。");
		return 0;
	}
	throw new Error("Unknown service command.");
}

async function commandExport(
	parsed: ParsedArgs,
	deps: Required<CliDeps>,
): Promise<number> {
	const siteKey = parsed.positionals[1];
	const file = parsed.positionals[2];
	if (!siteKey || !file) {
		throw new Error("Usage: qyctl export <site-key> <file>");
	}
	await withRuntime(parsed, deps, async (runtime) => {
		const service = new QingYanExportService(runtime.sqlite);
		const payload = service.exportSite({
			siteKey,
			include: fullExportInclude(),
		});
		await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
		deps.output.stdout.push(`站点导出已写入：${path.resolve(file)}`);
	});
	return 0;
}

async function commandImport(
	parsed: ParsedArgs,
	deps: Required<CliDeps>,
): Promise<number> {
	const siteKey = parsed.positionals[1];
	const file = parsed.positionals[2];
	if (!siteKey || !file) {
		throw new Error("Usage: qyctl import <site-key> <file>");
	}
	const payload = JSON.parse(await readFile(file, "utf-8")) as unknown;
	await withRuntime(parsed, deps, async (runtime) => {
		const backupService = new DatabaseBackupService({
			engine: runtime.config.database.client,
			databaseFile: runtime.databaseFile,
			sqlite: runtime.sqlite,
		});
		const service = new QingYanImportService(runtime.sqlite, backupService);
		const dryRun = service.createDryRun({
			siteKey,
			fileName: path.basename(file),
			payload,
			existingStrategy: "fail_on_existing",
			importMode: "full_site",
			settingsStrategy: "fail_on_existing",
		});
		deps.output.stdout.push(
			`导入预检：新增评论 ${dryRun.dryRun.summary.willCreateComments}，冲突 ${dryRun.dryRun.summary.conflicts}`,
		);
		if (hasFlag(parsed, "dry-run")) {
			return;
		}
		if (!hasFlag(parsed, "yes")) {
			throw new Error("IMPORT_CONFIRMATION_REQUIRED");
		}
		await deps.service.runWithStoppedService(async () => {
			const result = await service.applyWithBackup(dryRun.job.id, {
				existingStrategy: "fail_on_existing",
				importMode: "full_site",
				settingsStrategy: "fail_on_existing",
			});
			deps.output.stdout.push(
				`导入完成：创建评论 ${result.apply.summary.createdComments}，跳过 ${result.apply.summary.skippedExistingComments}`,
			);
		});
	});
	return 0;
}

async function commandUpgrade(
	parsed: ParsedArgs,
	deps: Required<CliDeps>,
): Promise<number> {
	const configPath = resolveCliConfigPath(
		flagString(parsed, "config"),
		deps.environment,
	);
	let loadedConfig: AppConfig | undefined;
	let configError: unknown;
	try {
		const runtime = await deps.openRuntime({
			configPath,
			environment: deps.environment,
		});
		loadedConfig = runtime.config;
		runtime.close();
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
		partialUpgradeMarkerPath: path.join(
			path.dirname(databaseFile),
			"upgrade",
			"partial-upgrade.json",
		),
	});
	const state = service.publicState();
	if (state.state !== "upgrade_required") {
		deps.output.stdout.push(`升级状态：${state.state}`);
		return state.state === "broken_config" ||
			state.state === "recovery_required"
			? 1
			: 0;
	}
	if (hasFlag(parsed, "dry-run")) {
		deps.output.stdout.push(JSON.stringify(state.plan, null, 2));
		return 0;
	}
	if (!hasFlag(parsed, "yes")) {
		throw new Error("UPGRADE_CONFIRMATION_REQUIRED");
	}
	await deps.service.runWithStoppedService(async () => {
		const result = await service.apply({
			confirm: "UPGRADE QINGYAN",
			backupDirectory: path.resolve(
				path.dirname(databaseFile),
				"backups",
				"upgrade",
			),
		});
		deps.output.stdout.push(JSON.stringify(result, null, 2));
	});
	return 0;
}

async function commandBackup(
	parsed: ParsedArgs,
	deps: Required<CliDeps>,
): Promise<number> {
	const file = parsed.positionals[1];
	if (!file) {
		throw new Error("Usage: qyctl backup <file>");
	}
	if (!hasFlag(parsed, "yes")) {
		throw new Error("BACKUP_CONFIRMATION_REQUIRED");
	}
	await withRuntime(parsed, deps, async (runtime) => {
		await deps.service.runWithStoppedService(async () => {
			const backup = new FullBackupService({
				configPath: runtime.configPath,
				config: runtime.config,
				databaseFile: runtime.databaseFile,
				sqlite: runtime.sqlite,
				packageVersion: runtime.packageVersion,
				env: deps.environment,
			});
			const result = await backup.createBackup({ outputPath: file });
			deps.output.stdout.push(`整站备份已创建：${result.outputDirectory}`);
			if (result.manifest.environment.detected.length > 0) {
				deps.output.stdout.push("检测到环境变量：");
				for (const item of result.manifest.environment.detected) {
					deps.output.stdout.push(
						`- ${item.name}${item.secret ? "（敏感）" : ""}`,
					);
				}
			}
		});
	});
	return 0;
}

async function commandRestore(
	parsed: ParsedArgs,
	deps: Required<CliDeps>,
): Promise<number> {
	const file = parsed.positionals[1];
	if (!file) {
		throw new Error("Usage: qyctl restore <file>");
	}
	const configPath = resolveCliConfigPath(
		flagString(parsed, "config"),
		deps.environment,
	);
	const service = new RestoreService({
		currentVersion: readPackageVersion(),
		currentConfigPath: configPath,
	});
	const plan = service.plan({ backupPath: file });
	deps.output.stdout.push(`备份版本：${plan.backupVersion}`);
	deps.output.stdout.push(`当前程序：${plan.currentVersion}`);
	deps.output.stdout.push(`数据库：${plan.databaseClient}`);
	deps.output.stdout.push(`配置文件：${plan.configPath}`);
	deps.output.stdout.push(
		`恢复后需要升级：${plan.upgradeRequired ? "是" : "否"}`,
	);
	if (hasFlag(parsed, "dry-run")) {
		return 0;
	}
	throw new Error("RESTORE_APPLY_NOT_IMPLEMENTED");
}

async function commandPageRegistry(
	parsed: ParsedArgs,
	deps: Required<CliDeps>,
): Promise<number> {
	const subcommand = parsed.positionals[1];
	if (subcommand !== "reconcile-pending") {
		throw new Error("Usage: qyctl page-registry reconcile-pending");
	}
	const siteKey = flagString(parsed, "site-key");
	const pageKeys = flagStrings(parsed, "page-key");
	const apply = hasFlag(parsed, "yes");
	await withRuntime(parsed, deps, async (runtime) => {
		const service = new PageRegistryService(runtime.db);
		const input = {
			siteKey,
			pageKeys: pageKeys.length > 0 ? pageKeys : undefined,
		};
		if (!apply) {
			const summary = await service.reconcileRegisteredPendingCandidates({
				...input,
				dryRun: true,
			});
			deps.output.stdout.push("已登记 pending 页面修复");
			deps.output.stdout.push("模式：dry-run");
			deps.output.stdout.push(JSON.stringify(summary, null, 2));
			deps.output.stdout.push("确认无误后追加 --yes 执行写入。");
			return;
		}
		await deps.service.runWithStoppedService(async () => {
			const summary = await service.reconcileRegisteredPendingCandidates(input);
			deps.output.stdout.push("已登记 pending 页面修复");
			deps.output.stdout.push("模式：apply");
			deps.output.stdout.push(JSON.stringify(summary, null, 2));
		});
	});
	return 0;
}

function formatUpdateCheckState(state: UpdateCheckState): string {
	return {
		not_checked: "尚未检查",
		no_release: "尚未发布 Release",
		current: "当前已是最新版本",
		update_available: "发现新版本",
		unsupported_release: "Release 不符合自动更新规则",
		check_failed: "检查失败",
	}[state];
}

async function commandUpdate(
	parsed: ParsedArgs,
	deps: Required<CliDeps>,
): Promise<number> {
	const subcommand = parsed.positionals[1];
	if (subcommand === "check") {
		const result = await deps.updateCheckService.check();
		deps.output.stdout.push("更新检测");
		deps.output.stdout.push(`当前版本：${result.currentVersion}`);
		deps.output.stdout.push(
			`更新源：GitHub Release / ${result.source.owner}/${result.source.repo}`,
		);
		deps.output.stdout.push(`状态：${formatUpdateCheckState(result.state)}`);
		deps.output.stdout.push(`说明：${result.message}`);
		return 0;
	}
	if (subcommand === "plan") {
		const plan = deps.updatePlanService.getUpdatePlan();
		deps.output.stdout.push("更新执行计划");
		deps.output.stdout.push(`执行入口：${plan.executor}`);
		deps.output.stdout.push(
			`预计不可用时间：${plan.estimatedRestartSeconds.min}-${plan.estimatedRestartSeconds.max} 秒`,
		);
		for (const [index, step] of plan.steps.entries()) {
			deps.output.stdout.push(`${index + 1}. ${step}`);
		}
		return 0;
	}
	throw new Error("Usage: qyctl update <check|plan>");
}

function createDefaultUpdateCheckService(): Pick<UpdateCheckService, "check"> {
	const client = new GitHubReleaseClient({
		owner: "Virace",
		repo: "QingYan",
	});
	return new GitHubUpdateCheckService({
		currentVersion: readPackageVersion(),
		source: {
			provider: "github-releases",
			owner: "Virace",
			repo: "QingYan",
			url: client.sourceUrl(),
		},
		fetchLatest: () => client.fetchLatest(),
	});
}

function createDefaultUpdatePlanService(): Pick<
	OpsStatusService,
	"getUpdatePlan"
> {
	return {
		getUpdatePlan() {
			return OpsStatusService.defaultUpdatePlan();
		},
	};
}

export async function runCli(
	args = process.argv.slice(2),
	deps: CliDeps = {},
): Promise<{ exitCode: number; output: CliOutput }> {
	const output = deps.output ?? { stdout: [], stderr: [] };
	const fullDeps: Required<CliDeps> = {
		openRuntime: deps.openRuntime ?? openCliRuntime,
		service: deps.service ?? new SystemdServiceController(),
		output,
		environment: deps.environment ?? process.env,
		updateCheckService:
			deps.updateCheckService ?? createDefaultUpdateCheckService(),
		updatePlanService:
			deps.updatePlanService ?? createDefaultUpdatePlanService(),
	};
	try {
		const parsed = parseArgs(args);
		const command = parsed.positionals[0];
		let exitCode: number;
		if (command === "info") {
			exitCode = await commandInfo(parsed, fullDeps);
		} else if (command === "admin") {
			exitCode = await commandAdmin(parsed, fullDeps);
		} else if (
			command === "status" ||
			command === "start" ||
			command === "stop" ||
			command === "restart"
		) {
			exitCode = await commandService(command, fullDeps);
		} else if (command === "export") {
			exitCode = await commandExport(parsed, fullDeps);
		} else if (command === "import") {
			exitCode = await commandImport(parsed, fullDeps);
		} else if (command === "upgrade") {
			exitCode = await commandUpgrade(parsed, fullDeps);
		} else if (command === "backup") {
			exitCode = await commandBackup(parsed, fullDeps);
		} else if (command === "restore") {
			exitCode = await commandRestore(parsed, fullDeps);
		} else if (command === "page-registry") {
			exitCode = await commandPageRegistry(parsed, fullDeps);
		} else if (command === "update") {
			exitCode = await commandUpdate(parsed, fullDeps);
		} else {
			throw new Error("Unknown command.");
		}
		return { exitCode, output };
	} catch (error) {
		output.stderr.push(error instanceof Error ? error.message : String(error));
		return { exitCode: 1, output };
	}
}

if (require.main === module) {
	runCli().then(({ exitCode, output }) => {
		for (const line of output.stdout) {
			console.log(line);
		}
		for (const line of output.stderr) {
			console.error(line);
		}
		process.exitCode = exitCode;
	});
}
