import { z } from "zod";

import type { TaskTypeDefinition } from "./task-type-registry";
import { TaskTypeRegistry } from "./task-type-registry";
import type { TaskRunnerContext } from "./task-runner-context";
import {
	backupPayloadSchema,
	runBackupTask,
	type BackupTaskPayload,
} from "./built-in/backup-task";
import {
	blacklistAutomationPayloadSchema,
	runBlacklistAutomationTask,
	type BlacklistAutomationPayload,
} from "./built-in/blacklist-automation-task";
import {
	dailySiteDigestPayloadSchema,
	runDailySiteDigestTask,
	type DailySiteDigestPayload,
} from "./built-in/daily-site-digest-task";
import {
	runSiteSettingsActionTask,
	siteSettingsActionPayloadSchema,
	type SiteSettingsActionPayload,
} from "./built-in/site-settings-action-task";

const maintenancePermissions = {
	read: "tasks.read",
	create: "tasks.schedule.create",
	run: "tasks.run",
	update: "tasks.schedule.update",
	delete: "tasks.schedule.delete",
};

const schedule = {
	manual: true,
	presets: ["hourly", "every_2_hours", "daily_morning", "weekly", "monthly"],
	cron: true,
	condition: true,
};

const defaultPolicy = {
	maxAttempts: 1,
	retryDelaySec: 0,
};

const pageSourceRefreshPayloadSchema = z.object({
	siteKey: z.string().min(1),
	sourceIds: z.array(z.number().int().positive()).optional(),
	mode: z.enum(["append", "replace"]).optional(),
	trigger: z.enum(["manual", "scheduled", "webhook"]).default("scheduled"),
	timeoutMs: z.number().int().positive().optional(),
	maxBytes: z.number().int().positive().optional(),
	maxAttempts: z.number().int().positive().optional(),
	retryDelaySec: z.number().int().nonnegative().optional(),
});

const pageMetadataRefreshPayloadSchema = z.object({
	siteKey: z.string().min(1),
	scope: z.enum(["missing_only", "force", "page_keys"]).default("missing_only"),
	pageKeys: z.array(z.string().min(1)).optional(),
	trigger: z.enum(["manual", "source_refresh", "scheduled"]).default("scheduled"),
	batchSize: z.number().int().positive().optional(),
	timeoutMs: z.number().int().positive().optional(),
	maxBytes: z.number().int().positive().optional(),
	maxAttempts: z.number().int().positive().optional(),
	retryDelaySec: z.number().int().nonnegative().optional(),
});

const ipVersionSchema = z.enum(["v4", "v6"]);

const commentIpRefreshPayloadSchema = z.object({
	siteKey: z.string().min(1).optional(),
	scope: z.enum(["missing", "failed", "stale", "all"]).default("missing"),
	ipVersions: z.array(ipVersionSchema).min(1).default(["v4", "v6"]),
	batchSize: z.number().int().positive().optional(),
	maxAttempts: z.number().int().positive().optional(),
	retryDelaySec: z.number().int().nonnegative().optional(),
});

const ipRegionUpdatePayloadSchema = z.object({
	ipVersions: z.array(ipVersionSchema).min(1).default(["v4", "v6"]),
	timeoutMs: z.number().int().positive().optional(),
	maxAttempts: z.number().int().positive().optional(),
	retryDelaySec: z.number().int().nonnegative().optional(),
});

type PageSourceRefreshPayload = z.infer<typeof pageSourceRefreshPayloadSchema>;
type PageMetadataRefreshPayload = z.infer<
	typeof pageMetadataRefreshPayloadSchema
>;
type CommentIpRefreshPayload = z.infer<typeof commentIpRefreshPayloadSchema>;
type IpRegionUpdatePayload = z.infer<typeof ipRegionUpdatePayloadSchema>;

async function emit(
	context: TaskRunnerContext,
	eventType: string,
	data?: unknown,
) {
	await context.writeEvent({
		eventType,
		level: eventType === "failed" || eventType === "blocked" ? "error" : "info",
		message: eventType,
		data,
	});
}

async function requireService<T>(
	context: TaskRunnerContext,
	serviceKey: keyof TaskRunnerContext["services"],
): Promise<T> {
	const service = context.services[serviceKey];
	if (!service) {
		await emit(context, "blocked", {
			reason: "service_missing",
			service: serviceKey,
		});
		throw new Error(`Task service missing: ${String(serviceKey)}`);
	}
	return service as T;
}

async function runWithEvents<TPayload>(
	payload: TPayload,
	context: TaskRunnerContext,
	run: (payload: TPayload, context: TaskRunnerContext) => Promise<unknown>,
) {
	await emit(context, "precondition_checked", { status: "ok" });
	try {
		const result = await run(payload, context);
		await emit(context, "succeeded", { result });
		return result;
	} catch (error) {
		if (
			!(
				error instanceof Error &&
				error.message.startsWith("Task service missing")
			)
		) {
			await emit(context, "failed", {
				message: error instanceof Error ? error.message : String(error),
			});
		}
		throw error;
	}
}

function defineTaskType<TPayload>(
	definition: Omit<TaskTypeDefinition<TPayload>, "category" | "permissions"> & {
		category?: TaskTypeDefinition<TPayload>["category"];
	},
): TaskTypeDefinition<TPayload> {
	return {
		...definition,
		category: definition.category ?? "maintenance",
		permissions: maintenancePermissions,
	};
}

export function createBuiltInTaskTypeRegistry(): TaskTypeRegistry {
	const registry = new TaskTypeRegistry();

	registry.register(
		defineTaskType<PageSourceRefreshPayload>({
			type: "page_source_refresh",
			label: "页面来源刷新",
			description: "刷新站点 sitemap/RSS/Atom 来源并更新页面注册表。",
			scope: "site",
			payloadSchema: pageSourceRefreshPayloadSchema,
			defaultPayload: { siteKey: "", trigger: "scheduled" },
			defaultPolicy,
			schedule,
			dangerous: false,
			reuse: {
				service: "PageSourceRefreshService",
				method: "executeRefresh",
				file: "src/modules/page-registry/source-refresh-service.ts",
			},
			run(payload, context) {
				return runWithEvents(
					payload,
					context,
					async (validated, runnerContext) => {
						const service = await requireService<{
							executeRefresh(
								input: unknown,
								context: TaskRunnerContext,
							): Promise<unknown>;
						}>(runnerContext, "pageSourceRefresh");
						return service.executeRefresh({
							siteKey: validated.siteKey,
							sourceIds: validated.sourceIds,
							mode: validated.mode,
							trigger: validated.trigger,
							timeoutMs: validated.timeoutMs,
							maxBytes: validated.maxBytes,
						}, runnerContext);
					},
				);
			},
		}),
	);
	registry.register(
		defineTaskType<PageMetadataRefreshPayload>({
			type: "page_metadata_refresh",
			label: "页面 Title 刷新",
			description: "刷新页面 HTML title 元数据。",
			scope: "site",
			payloadSchema: pageMetadataRefreshPayloadSchema,
			defaultPayload: {
				siteKey: "",
				scope: "missing_only",
				trigger: "scheduled",
			},
			defaultPolicy,
			schedule,
			dangerous: false,
			reuse: {
				service: "PageMetadataRefreshService",
				method: "executeRefresh",
				file: "src/modules/page-registry/title-refresh-service.ts",
			},
			run(payload, context) {
				return runWithEvents(
					payload,
					context,
					async (validated, runnerContext) => {
						const service = await requireService<{
							executeRefresh(
								input: unknown,
								context: TaskRunnerContext,
							): Promise<unknown>;
						}>(runnerContext, "pageMetadataRefresh");
						return service.executeRefresh({
							siteKey: validated.siteKey,
							pageKeys: validated.pageKeys,
							onlyMissingTitle: validated.scope === "missing_only",
							forceTitle: validated.scope === "force",
							trigger: validated.trigger,
							batchSize: validated.batchSize,
							timeoutMs: validated.timeoutMs,
							maxBytes: validated.maxBytes,
						}, runnerContext);
					},
				);
			},
		}),
	);
	registry.register(
		defineTaskType<CommentIpRefreshPayload>({
			type: "comment_ip_refresh",
			label: "评论 IP 刷新",
			description: "基于已有评论请求元数据补齐 IP 地域信息。",
			scope: "site",
			payloadSchema: commentIpRefreshPayloadSchema,
			defaultPayload: { scope: "missing", ipVersions: ["v4", "v6"] },
			defaultPolicy,
			schedule,
			dangerous: false,
			reuse: {
				service: "CommentIpMaintenanceService",
				method: "executeCommentIpRefresh",
				file: "src/modules/comments/metadata/comment-ip-maintenance-service.ts",
			},
			run(payload, context) {
				return runWithEvents(
					payload,
					context,
					async (validated, runnerContext) => {
						const service = await requireService<{
							executeCommentIpRefresh(
								input: unknown,
								context: TaskRunnerContext,
							): Promise<unknown>;
						}>(runnerContext, "commentIpMaintenance");
						return service.executeCommentIpRefresh({
							siteKey: validated.siteKey,
							scope: validated.scope,
							ipVersions: validated.ipVersions,
							batchSize: validated.batchSize,
						}, runnerContext);
					},
				);
			},
		}),
	);
	registry.register(
		defineTaskType<IpRegionUpdatePayload>({
			type: "ip_region_update",
			label: "IP 库更新",
			description: "更新 IPv4/IPv6 IP 地域数据库。",
			scope: "global",
			payloadSchema: ipRegionUpdatePayloadSchema,
			defaultPayload: { ipVersions: ["v4", "v6"] },
			defaultPolicy,
			schedule,
			dangerous: false,
			reuse: {
				service: "CommentIpMaintenanceService",
				method: "executeIpRegionUpdate",
				file: "src/modules/comments/metadata/comment-ip-maintenance-service.ts",
			},
			run(payload, context) {
				return runWithEvents(
					payload,
					context,
					async (validated, runnerContext) => {
						const service = await requireService<{
							executeIpRegionUpdate(
								input: unknown,
								context: TaskRunnerContext,
							): Promise<unknown>;
						}>(runnerContext, "commentIpMaintenance");
						return service.executeIpRegionUpdate({
							ipVersions: validated.ipVersions,
							timeoutMs: validated.timeoutMs,
						}, runnerContext);
					},
				);
			},
		}),
	);
	registry.register(
		defineTaskType<BackupTaskPayload>({
			type: "backup",
			label: "站点备份",
			description: "复用现有 QingYan 导出/备份服务生成任务备份结果。",
			category: "backup",
			scope: "site",
			payloadSchema: backupPayloadSchema,
			defaultPayload: {
				scope: "site",
				siteKey: "",
				include: {
					siteSettings: true,
					pageThreads: true,
					comments: true,
					visitors: true,
					voteRecords: true,
					pageFeedbackRecords: true,
					blacklistRules: true,
					rawUserAgent: false,
				},
				retentionCount: 5,
			},
			defaultPolicy,
			schedule,
			dangerous: false,
			reuse: {
				service: "QingYanExportService",
				method: "exportSite",
				file: "src/modules/import-export/qingyan/export-service.ts",
			},
			run(payload, context) {
				return runWithEvents(payload, context, runBackupTask);
			},
		}),
	);
	registry.register(
		defineTaskType<SiteSettingsActionPayload>({
			type: "site_settings_action",
			label: "站点设置临时动作",
			description: "临时关闭评论、访客、PV、互动或提升验证码，并记录恢复快照。",
			category: "system",
			scope: "site",
			payloadSchema: siteSettingsActionPayloadSchema,
			defaultPayload: {
				siteKey: "",
				action: "disable_comments",
				ttlSec: 3600,
			},
			defaultPolicy,
			schedule,
			dangerous: true,
			reuse: {
				service: "AdminManagementService",
				method: "updateSettings",
				file: "src/modules/admin/management-service.ts",
			},
			run(payload, context) {
				return runWithEvents(payload, context, runSiteSettingsActionTask);
			},
		}),
	);
	registry.register(
		defineTaskType<BlacklistAutomationPayload>({
			type: "blacklist_automation",
			label: "黑名单自动化",
			description: "按条件结果创建短期站点黑名单规则，并在日志中脱敏目标值。",
			category: "system",
			scope: "site",
			payloadSchema: blacklistAutomationPayloadSchema,
			defaultPayload: {
				siteKey: "",
				targetType: "ip",
				matchMode: "exact",
				targetValue: "",
				scope: "post",
				expiresInSec: 3600,
			},
			defaultPolicy,
			schedule,
			dangerous: true,
			reuse: {
				service: "AdminManagementService",
				method: "createBlacklist",
				file: "src/modules/admin/management-service.ts",
			},
			run(payload, context) {
				return runWithEvents(payload, context, runBlacklistAutomationTask);
			},
		}),
	);
	registry.register(
		defineTaskType<DailySiteDigestPayload>({
			type: "daily_site_digest",
			label: "每日站点摘要",
			description: "复用后台用户通知收件人和通知任务模型创建每日摘要投递任务。",
			category: "notification",
			scope: "site",
			payloadSchema: dailySiteDigestPayloadSchema,
			defaultPayload: {
				siteKey: "",
				sendIfNoActivity: false,
			},
			defaultPolicy,
			schedule,
			dangerous: false,
			reuse: {
				service: "BackendUserNotificationRecipientsRepository",
				method: "listSiteRecipients",
				file: "src/modules/notifications/backend-user-recipients-repository.ts",
			},
			run(payload, context) {
				return runWithEvents(payload, context, runDailySiteDigestTask);
			},
		}),
	);

	return registry;
}
