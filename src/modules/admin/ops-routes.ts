import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { AdminRepository } from "./repository";
import { AdminSessionService } from "./session-service";
import {
	getServiceControlStatus,
	resolveAdminServiceControl,
	serviceRestartConfirmation,
} from "./service-control";
import { CommentIpMaintenanceService } from "../comments/metadata/comment-ip-maintenance-service";
import { GitHubReleaseClient } from "../ops/github-release-client";
import { OpsStatusService } from "../ops/ops-status-service";
import { UpdateCheckService } from "../ops/update-check-service";
import { PageRegistryService } from "../page-registry/service";
import { AppError } from "../shared/errors";
import { InvalidRequestError } from "../shared/errors";
import { RuntimeSystemSettingsService } from "../system-settings/service";
import { AdminTaskService } from "../tasks/admin-task-service";
import { TaskRunRepository } from "../tasks/task-run-repository";
import type { TaskRunStatus } from "../tasks/types";
import { UpgradeService } from "../upgrade/upgrade-service";
import { requirePermission, requireSiteAccess } from "./authorization";
import { DeletionPolicyService } from "./deletion-policy-service";

const ipVersionSchema = z.enum(["v4", "v6"]);
const ipRegionUpdateBodySchema = z.object({
	ipVersions: z.array(ipVersionSchema).min(1).max(2),
	timeoutMs: z.number().int().min(1000).max(60_000).optional(),
	runAfter: z.string().datetime().nullable().optional(),
	maxAttempts: z.number().int().min(1).max(10).optional(),
	retryDelaySec: z.number().int().min(0).max(86_400).optional(),
});
const commentIpRefreshBodySchema = z.object({
	scope: z.enum(["missing", "failed", "stale", "all"]),
	ipVersions: z.array(ipVersionSchema).min(1).max(2),
	siteKey: z.string().min(1).optional(),
	batchSize: z.number().int().min(1).max(5000).default(500),
	runAfter: z.string().datetime().nullable().optional(),
	maxAttempts: z.number().int().min(1).max(10).optional(),
	retryDelaySec: z.number().int().min(0).max(86_400).optional(),
});
const serviceRestartBodySchema = z.object({
	confirm: z.literal(serviceRestartConfirmation),
});
const maintenanceTasksQuerySchema = z.object({
	siteKey: z.string().min(1).optional(),
	type: z.string().min(1).optional(),
	status: z.string().min(1).optional(),
	limit: z.coerce.number().int().positive().max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0),
});
const pageTitleRefreshTaskBodySchema = z.object({
	siteKey: z.string().min(1),
	pageKeys: z.array(z.string().min(1)).min(1).max(100).optional(),
	onlyMissingTitle: z.boolean().default(true),
	forceTitle: z.boolean().optional(),
	batchSize: z.number().int().min(1).max(5000).optional(),
	timeoutMs: z.number().int().min(1000).max(60_000).optional(),
	maxBytes: z
		.number()
		.int()
		.min(65_536)
		.max(10 * 1024 * 1024)
		.optional(),
	runAfter: z.string().datetime().nullable().optional(),
	maxAttempts: z.number().int().min(1).max(10).optional(),
	retryDelaySec: z.number().int().min(0).max(86_400).optional(),
});
const delayedDeletionsQuerySchema = z.object({
	siteKey: z.string().min(1).optional(),
	status: z
		.enum(["pending", "restored", "hard_deleted"])
		.optional()
		.default("pending"),
	limit: z.coerce.number().int().positive().max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0),
});
const delayedDeletionParamsSchema = z.object({
	deletionId: z.coerce.number().int().positive(),
});
const delayedDeletionCleanupBodySchema = z.object({
	now: z.string().datetime().optional(),
});

function readPackageVersion(): string {
	const packagePath = path.resolve(process.cwd(), "package.json");
	const packageJson = JSON.parse(readFileSync(packagePath, "utf-8")) as {
		version?: string;
	};
	return packageJson.version ?? "0.0.0";
}

export const adminOpsRoutes: FastifyPluginAsync = async (fastify) => {
	const repository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		repository,
		fastify.adminBootstrap,
		fastify.siteRegistry,
	);
	const version = readPackageVersion();
	const databaseFile = path.resolve(
		process.cwd(),
		fastify.config.database.sqlite.file,
	);
	const upgradeService = new UpgradeService({
		configPath: process.env.QINGYAN_CONFIG_PATH ?? "config/qingyan.yml",
		loadedConfig: fastify.config,
		databaseFile,
		currentApplicationVersion: version,
		partialUpgradeMarkerPath: path.join(
			path.dirname(databaseFile),
			"upgrade",
			"partial-upgrade.json",
		),
		createSqliteClient: (file) => new Database(file),
	});
	const releaseClient = new GitHubReleaseClient({
		owner: "Virace",
		repo: "QingYan",
	});
	const updateCheckService = new UpdateCheckService({
		currentVersion: version,
		source: {
			provider: "github-releases",
			owner: "Virace",
			repo: "QingYan",
			url: releaseClient.sourceUrl(),
		},
		fetchLatest: () => releaseClient.fetchLatest(),
	});
	const ops = new OpsStatusService({
		version,
		upgradeService,
		updateCheckService,
	});
	const serviceControl = resolveAdminServiceControl({
		injected: fastify.serviceControl,
	});
	const taskRuns = new TaskRunRepository(fastify.db);
	const adminTasks = new AdminTaskService(fastify.db, fastify.siteRegistry);
	const pageRegistryService = new PageRegistryService(fastify.db);
	const deletionPolicyService = new DeletionPolicyService(fastify.db);
	const systemSettings = new RuntimeSystemSettingsService(fastify.db);
	const ipMaintenance = new CommentIpMaintenanceService(fastify.db, {
		loadIpRegionSettings: () => systemSettings.getIpRegionSettings(),
	});

	async function hardDeleteDelayedRecord(record: {
		resourceType: string;
		resourceId: string;
		siteId: number | null;
		metadataJson?: string | null;
	}) {
		if (record.resourceType === "page") {
			return pageRegistryService.hardDeletePage({
				pageKey: record.resourceId,
				siteId: record.siteId,
			});
		}
		if (record.resourceType === "page_trash") {
			return pageRegistryService.hardDeletePages({
				pageKeys: readDelayedDeletionPageKeys(record.metadataJson),
				siteId: record.siteId,
			});
		}
		throw new AppError(
			409,
			"DELAYED_DELETION_RESOURCE_UNSUPPORTED",
			"延迟删除资源类型暂不支持清理。",
		);
	}

	async function restoreDelayedRecord(record: {
		resourceType: string;
		resourceId: string;
		siteId: number | null;
		metadataJson?: string | null;
	}) {
		if (record.resourceType === "page") {
			return pageRegistryService.restoreDeletedPage({
				pageKey: record.resourceId,
				siteId: record.siteId,
			});
		}
		if (record.resourceType === "page_trash") {
			const restoredCount = await pageRegistryService.restoreDeletedPages({
				pageKeys: readDelayedDeletionPageKeys(record.metadataJson),
				siteId: record.siteId,
			});
			return {
				resourceType: record.resourceType,
				resourceId: record.resourceId,
				restoredCount,
			};
		}
		throw new AppError(
			409,
			"DELAYED_DELETION_RESOURCE_UNSUPPORTED",
			"延迟删除资源类型暂不支持恢复。",
		);
	}

	function readDelayedDeletionPageKeys(metadataJson?: string | null) {
		if (!metadataJson) {
			return [];
		}
		try {
			const metadata = JSON.parse(metadataJson) as {
				pages?: Array<{ pageKey?: unknown }>;
			};
			return (
				metadata.pages
					?.map((page) => page.pageKey)
					.filter(
						(pageKey): pageKey is string => typeof pageKey === "string",
					) ?? []
			);
		} catch {
			return [];
		}
	}

	fastify.get("/status", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "ops.read");
		return ops.getStatus();
	});

	fastify.post("/upgrade/dry-run", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "ops.upgrade");
		return upgradeService.publicState();
	});

	fastify.post("/update/plan", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "ops.update_check");
		return ops.getUpdatePlan();
	});

	fastify.post("/update/check", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "ops.update_check");
		return ops.checkForUpdates();
	});

	fastify.get("/service-control", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "ops.service_control");
		return getServiceControlStatus(serviceControl);
	});

	fastify.post("/service-control/restart", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "ops.service_control");
		const parsed = serviceRestartBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		if (!serviceControl.controller) {
			await fastify.security.writeAudit({
				requestId: request.context?.requestId,
				actorType: "admin_user",
				actorId: String(session.user.id),
				event: "ops.service_restart.rejected",
				level: "warn",
				message: "服务重启请求被拒绝：服务控制未启用",
				targetType: "service",
				targetId: serviceControl.unit,
				payload: {
					mode: serviceControl.mode,
				},
			});
			throw new AppError(403, "SERVICE_CONTROL_DISABLED", "服务控制未启用。");
		}

		await fastify.security.writeAudit({
			requestId: request.context?.requestId,
			actorType: "admin_user",
			actorId: String(session.user.id),
			event: "ops.service_restart.requested",
			level: "warn",
			message: "管理员请求重启 QingYan 服务",
			targetType: "service",
			targetId: serviceControl.unit,
			payload: {
				mode: serviceControl.mode,
			},
		});
		await serviceControl.controller.restart();
		return {
			ok: true,
			state: await serviceControl.controller.status(),
		};
	});

	fastify.get("/ip-region", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "ops.read");
		const status = await ipMaintenance.getStatus();
		const recentRuns = await taskRuns.listForTaskCenter({
			category: "maintenance",
			limit: 10,
			offset: 0,
		});
		return {
			...status,
			recentJobs: recentRuns.items.filter((run) =>
				["ip_region_update", "comment_ip_refresh"].includes(run.type),
			),
		};
	});

	fastify.post("/ip-region/update", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "ip_region_settings.update");
		const parsed = ipRegionUpdateBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		const run = await adminTasks.createManualRun(
			{
				type: "ip_region_update",
				payload: {
					ipVersions: parsed.data.ipVersions,
					timeoutMs: parsed.data.timeoutMs,
				},
				runAfter: parsed.data.runAfter ?? null,
				maxAttempts: parsed.data.maxAttempts,
				retryDelaySec: parsed.data.retryDelaySec,
			},
			session,
			request.context?.requestId,
		);
		return { run };
	});

	fastify.post("/comment-ip/refresh", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "tasks.run");
		const parsed = commentIpRefreshBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.data.siteKey,
		});
		const run = await adminTasks.createManualRun(
			{
				type: "comment_ip_refresh",
				siteKey: parsed.data.siteKey,
				payload: {
					siteKey: parsed.data.siteKey,
					scope: parsed.data.scope,
					ipVersions: parsed.data.ipVersions,
					batchSize: parsed.data.batchSize,
				},
				runAfter: parsed.data.runAfter ?? null,
				maxAttempts: parsed.data.maxAttempts,
				retryDelaySec: parsed.data.retryDelaySec,
			},
			session,
			request.context?.requestId,
		);
		return { run };
	});

	fastify.get("/tasks", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "tasks.read");
		const parsed = maintenanceTasksQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.data.siteKey,
		});
		const taskRunPage = await taskRuns.listForTaskCenter({
			siteKey: parsed.data.siteKey,
			type: parsed.data.type,
			status: parsed.data.status as TaskRunStatus | undefined,
			limit: parsed.data.limit,
			offset: parsed.data.offset,
		});
		const taskRunItems = taskRunPage.items.map((task) => ({
			source: "task_run" as const,
			...task,
			scope: task.payloadSummary,
			queueState: {
				waitingReason:
					task.status === "delayed"
						? "delayed_until_run_after"
						: task.status === "retrying"
							? "retry_wait"
							: ["succeeded", "failed", "suppressed", "cancelled"].includes(
										task.status,
									)
								? "terminal"
								: "ready_for_runner",
				waitingDescription: task.runAfter
					? `任务预计 ${task.runAfter} 后可运行。`
					: "任务已进入统一队列。",
				readyAt: task.runAfter ?? task.updatedAt,
			},
		}));
		const items = taskRunItems
			.sort((left, right) =>
				(right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
			)
			.slice(0, parsed.data.limit);
		return {
			items,
			totalCount: taskRunPage.totalCount,
			limit: parsed.data.limit,
			offset: parsed.data.offset,
		};
	});

	fastify.get("/delayed-deletions", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "ops.read");
		const parsed = delayedDeletionsQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.data.siteKey,
		});
		const site = parsed.data.siteKey
			? await repository.getSiteByKey(parsed.data.siteKey)
			: undefined;
		return deletionPolicyService.listDelayedDeletions({
			siteId: site?.id,
			status: parsed.data.status,
			limit: parsed.data.limit,
			offset: parsed.data.offset,
		});
	});

	fastify.post("/delayed-deletions/:deletionId/restore", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "ops.restore");
		const parsed = delayedDeletionParamsSchema.safeParse(request.params);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		let restoredCount = 0;
		const deletion = await deletionPolicyService.restoreDeletion({
			id: parsed.data.deletionId,
			actorUserId: session.user.id,
			restore: async (record) => {
				const resource = await restoreDelayedRecord(record);
				restoredCount = resource.restoredCount;
				return restoredCount;
			},
		});
		await fastify.security.writeAudit({
			requestId: request.context?.requestId,
			actorType: "admin_user",
			actorId: String(session.user.id),
			action: "delayed_deletion.restored",
			targetType: deletion.resourceType,
			targetId: deletion.resourceId,
			payload: {
				id: deletion.id,
				siteId: deletion.siteId,
				resourceType: deletion.resourceType,
				resourceId: deletion.resourceId,
				requestedByUserId: deletion.requestedByUserId,
				requestedAt: deletion.requestedAt,
				restoredByUserId: deletion.restoredByUserId,
				restoredAt: deletion.restoredAt,
				restoredCount,
			},
		});
		return {
			deletion,
			resource: {
				resourceType: deletion.resourceType,
				resourceId: deletion.resourceId,
				restoredCount,
			},
		};
	});

	fastify.post("/delayed-deletions/cleanup", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "tasks.run");
		const parsed = delayedDeletionCleanupBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		const result = await deletionPolicyService.runDueHardDeletes({
			now: parsed.data.now ? new Date(parsed.data.now) : undefined,
			hardDelete: hardDeleteDelayedRecord,
		});
		await fastify.security.writeAudit({
			requestId: request.context?.requestId,
			actorType: "admin_user",
			actorId: String(session.user.id),
			action: "delayed_deletion.cleanup",
			targetType: "delayed_deletions",
			targetId: "cleanup",
			payload: result,
		});
		return result;
	});

	fastify.post("/tasks/page-title-refresh", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = pageTitleRefreshTaskBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.data.siteKey,
			permission: "tasks.run",
		});
		const run = await adminTasks.createManualRun(
			{
				type: "page_metadata_refresh",
				siteKey: parsed.data.siteKey,
				payload: {
					siteKey: parsed.data.siteKey,
					scope: parsed.data.forceTitle
						? "force"
						: parsed.data.pageKeys?.length
							? "page_keys"
							: "missing_only",
					trigger: "manual",
					pageKeys: parsed.data.pageKeys,
					batchSize: parsed.data.batchSize,
					timeoutMs: parsed.data.timeoutMs,
					maxBytes: parsed.data.maxBytes,
				},
				runAfter: parsed.data.runAfter ?? null,
				maxAttempts: parsed.data.maxAttempts,
				retryDelaySec: parsed.data.retryDelaySec,
			},
			session,
			request.context?.requestId,
		);
		return { run };
	});
};
