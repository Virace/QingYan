import { existsSync } from "node:fs";
import { LegacySqliteConfigError } from "../../config/load-config";
import type { AppConfig } from "../../config/types";
import { createDatabaseClients } from "../../db/client";
import { getDatabaseMigrationState } from "../../db/migrations";
import {
	type PartialUpgradeMarker,
	readPartialUpgradeMarker,
} from "./partial-marker";
import type { UpgradeApplicationStep, UpgradePlan } from "./upgrade-plan";

export type UpgradeRuntimeState =
	| { state: "not_installed" }
	| { state: "normal_current" }
	| { state: "upgrade_required"; plan: UpgradePlan }
	| {
			state: "recovery_required";
			reason: string;
			recovery: PartialUpgradeMarker | null;
	  }
	| { state: "broken_config"; reason: string };
export interface UpgradeDetectorInput {
	configPath: string;
	loadedConfig?: AppConfig;
	configError?: unknown;
	currentApplicationVersion: string;
	partialUpgradeMarkerPath?: string;
	requiredApplicationUpgrades?: UpgradeApplicationStep[];
	migrationDirectory?: string;
}
export function compareVersions(left: string, right: string): number {
	const a = left.replace(/^v/, "").split(".").map(Number);
	const b = right.replace(/^v/, "").split(".").map(Number);
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const delta = (a[index] ?? 0) - (b[index] ?? 0);
		if (delta) return delta;
	}
	return 0;
}
export function classifyConnectionError(error: unknown): string {
	const code = (error as { code?: string })?.code;
	if (code === "28P01" || code === "28000")
		return "database_authentication_failed";
	if (code === "42501") return "database_permission_denied";
	if (code === "3D000") return "database_not_found";
	if (
		code?.startsWith("ERR_TLS") ||
		code?.startsWith("CERT_") ||
		code === "DEPTH_ZERO_SELF_SIGNED_CERT"
	)
		return "database_tls_failed";
	if (
		code === "ENOTFOUND" ||
		code === "ECONNREFUSED" ||
		code === "ETIMEDOUT" ||
		code === "ECONNRESET"
	)
		return "database_unavailable";
	return "database_probe_failed";
}
export async function detectUpgradeRuntimeState(
	input: UpgradeDetectorInput,
): Promise<UpgradeRuntimeState> {
	// 本地未完成标记优先于配置与数据库正常状态。
	if (
		input.partialUpgradeMarkerPath &&
		existsSync(input.partialUpgradeMarkerPath)
	)
		return {
			state: "recovery_required",
			reason: "partial_upgrade_marker",
			recovery: readPartialUpgradeMarker(input.partialUpgradeMarkerPath),
		};
	if (input.configError)
		return {
			state: "broken_config",
			reason:
				input.configError instanceof LegacySqliteConfigError
					? "sqlite_offline_conversion_required"
					: "config_invalid",
		};
	if (!input.loadedConfig)
		return existsSync(input.configPath)
			? { state: "broken_config", reason: "config_invalid" }
			: { state: "not_installed" };
	const clients = createDatabaseClients(
		input.loadedConfig.database.url,
		input.loadedConfig.database,
	);
	try {
		const version = await clients.pool.query<{ version: number }>(
			"SELECT current_setting('server_version_num')::int AS version",
		);
		if (
			!version.rows[0] ||
			version.rows[0].version < 180000 ||
			version.rows[0].version >= 190000
		)
			return { state: "broken_config", reason: "database_version_unsupported" };
		const tables = await clients.pool.query<{ name: string }>(
			"SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')",
		);
		if (tables.rows.length === 0) return { state: "not_installed" };
		const names = new Set(tables.rows.map((row) => row.name));
		let upgrades: Array<{
			name: string;
			to_version: string;
			summary_json: unknown;
		}> = [];
		if (names.has("__qingyan_upgrades"))
			upgrades = (
				await clients.pool.query<{
					name: string;
					to_version: string;
					summary_json: unknown;
				}>(
					"SELECT name,to_version,summary_json FROM __qingyan_upgrades ORDER BY applied_at DESC,name DESC",
				)
			).rows;
		const started = upgrades.find(
			(row) => row.name === "sqlite-to-postgresql-started",
		);
		const completed = upgrades.find(
			(row) => row.name === "sqlite-to-postgresql-completed",
		);
		const conversionId = (row: typeof started) => {
			if (!row) return undefined;
			const summary =
				typeof row.summary_json === "string"
					? JSON.parse(row.summary_json)
					: row.summary_json;
			return (summary as { conversionId?: string })?.conversionId;
		};
		if (
			started &&
			(!completed ||
				!conversionId(started) ||
				conversionId(started) !== conversionId(completed))
		)
			return {
				state: "recovery_required",
				reason: "incomplete_database_conversion",
				recovery: null,
			};
		if (!names.has("__qingyan_migrations"))
			return {
				state: "recovery_required",
				reason: "database_schema_ledger_missing",
				recovery: null,
			};
		const completedUpgrades = upgrades.filter(
			(row) => row.name !== "sqlite-to-postgresql-started",
		);

		const migrations = await getDatabaseMigrationState(
			clients.pool,
			input.migrationDirectory,
		);
		if (migrations.unknown.length || migrations.checksumMismatches.length)
			return {
				state: "broken_config",
				reason: migrations.unknown.length
					? "database_schema_too_new"
					: "database_schema_checksum_mismatch",
			};
		if (
			completedUpgrades.some(
				(row) =>
					row.to_version &&
					compareVersions(row.to_version, input.currentApplicationVersion) > 0,
			)
		)
			return { state: "broken_config", reason: "database_application_too_new" };
		const applied = new Set(upgrades.map((row) => row.name));
		const steps = (input.requiredApplicationUpgrades ?? []).filter(
			(step) => !applied.has(step.name),
		);
		const currentVersion =
			completedUpgrades.find((row) => row.to_version)?.to_version ?? "unknown";
		if (currentVersion !== input.currentApplicationVersion)
			steps.unshift({
				name: `application-version:${input.currentApplicationVersion}`,
				fromVersion: currentVersion,
				toVersion: input.currentApplicationVersion,
			});
		if (migrations.pending.length || steps.length) {
			const plan: UpgradePlan = {
				currentVersion,
				targetVersion: input.currentApplicationVersion,
				schemaMigrations: migrations.pending.map((name) => ({ name })),
				applicationUpgrades: steps,
				configChanges: [],
				dbSettingChanges: [],
				secretHandling: ["数据库 URL 与 TLS 私钥不进入公开计划。"],
				backupPaths: {
					database: "data/backups/upgrades/<upgrade-id>/database/qingyan.dump",
					config: "data/backups/upgrades/<upgrade-id>/config/qingyan.yml",
					plan: "data/backups/upgrades/<upgrade-id>/upgrade-plan.json",
				},
				risks: [
					"确认后先停止业务写入并完成 PostgreSQL 整实例备份，再执行升级。",
				],
			};
			if (migrations.pending.includes("0001_api_abuse_and_email_policy.sql")) {
				plan.dbSettingChanges.push(
					{
						path: "site_settings.email_policy",
						action: "add",
						after: {
							mode: "allow_all",
							allowed: [],
							denied: [],
							protectedDomains: [],
						},
						note: "默认不限制访客邮箱来源；受保护域名需按站点显式配置。",
					},
					{
						path: "site_settings.moderation.localReviewEnabled",
						action: "add",
						after: false,
						note: "保留当前站点审核方式；启用本地后置审核前确认待审邮件接收人。",
					},
				);
				plan.risks.push(
					"旧验证码会话与验证授权将失效，访客需要重新完成验证；新授权绑定站点与操作且只消费一次。",
					"历史评论缺少可靠人工审核来源或批准时间时保留未知，不作为新后置审核的充分公开依据。",
					"新增独立 IP 与短突发额度按默认策略生效，共享出口可在站点设置调整；本地处罚和已确认复犯状态持久保存。",
				);
			}
			return { state: "upgrade_required", plan };
		}
		if (!names.has("admin_bootstrap_state") || !names.has("sites"))
			return {
				state: "recovery_required",
				reason: "database_initialization_incomplete",
				recovery: null,
			};
		const counts = await clients.pool.query<{ installed: boolean }>(
			"SELECT EXISTS(SELECT 1 FROM admin_bootstrap_state WHERE id=1) AND EXISTS(SELECT 1 FROM sites) AS installed",
		);
		return counts.rows[0]?.installed
			? { state: "normal_current" }
			: {
					state: "recovery_required",
					reason: "database_initialization_incomplete",
					recovery: null,
				};
	} catch (error) {
		return { state: "broken_config", reason: classifyConnectionError(error) };
	} finally {
		await clients.close();
	}
}
