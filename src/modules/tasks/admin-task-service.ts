import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";

import type { AppDatabase } from "../../db/client";
import {
	auditLogs,
	adminGroups,
	adminUserGroups,
	adminUsers,
	adminUserSiteAccess,
} from "../../db/schema";
import type { AuthenticatedAdminSession } from "../admin/session-service";
import { toValidationFields } from "../admin/validation-fields";
import {
	AppError,
	ResourceNotFoundError,
	ValidationFailedError,
} from "../shared/errors";
import type { SiteRegistry } from "../shared/site-registry";
import { NotificationChannelConfigsRepository } from "../notifications/channel-configs-repository";
import { BackendUserNotificationRecipientsRepository } from "../notifications/backend-user-recipients-repository";
import {
	calculateNextRunAt,
	validateScheduleDefinition,
} from "./schedule-calculator";
import { createBuiltInTaskTypeRegistry } from "./built-in-task-types";
import {
	isJsonEqual,
	isRecord,
	readPath,
	setPath,
	protectedOperationReason,
	type ProtectedTaskOperation,
} from "./protected-task-policy";
import {
	ScheduledTaskRepository,
	type ScheduledTaskRecord,
} from "./scheduled-task-repository";
import { SystemManagedTaskService } from "./system-managed-task-service";
import {
	PageSourceRefreshPolicyService,
	readPageSourceRefreshSiteKey,
} from "./page-source-refresh-policy";
import { TaskRunRepository } from "./task-run-repository";
import type { TaskRunRecord } from "./types";
import {
	canManageScheduledTask,
	canRunScheduledTask,
	canViewTaskLogs,
	projectDeletedSnapshotForSession,
	projectScheduledTaskForSession,
	projectTaskRunForSession,
	type TaskVisibilitySession,
} from "./task-visibility";

const RETENTION_COUNT_MAX = 30;

function toVisibilitySession(
	session: AuthenticatedAdminSession,
): TaskVisibilitySession {
	return {
		userId: session.user.id,
		groupKey: session.groupKey,
		isAdmin: session.isAdmin,
		isInitialAdmin: session.isInitialAdmin,
		siteIds: session.siteIds,
		permissions: session.permissions,
	};
}

function validationField(path: string, message: string) {
	return {
		path,
		code: "custom",
		message,
		received: "unknown",
	};
}

export interface ScheduledTaskWriteInput {
	name?: string;
	description?: string | null;
	type?: string;
	siteKey?: string | null;
	scopeKind?: string;
	scope?: unknown;
	enabled?: boolean;
	scheduleKind?: string;
	schedulePreset?: string | null;
	cronExpression?: string | null;
	timezone?: string | null;
	payload?: unknown;
	policy?: unknown;
	trigger?: unknown;
	retentionCount?: number;
}

export interface ManualTaskRunInput {
	type: string;
	siteKey?: string | null;
	payload: Record<string, unknown>;
	runAfter?: string | null;
	maxAttempts?: number;
	retryDelaySec?: number;
	priority?: number;
	concurrencyKey?: string | null;
}

export class AdminTaskService {
	private readonly registry = createBuiltInTaskTypeRegistry();
	private readonly scheduledTasks: ScheduledTaskRepository;
	private readonly taskRuns: TaskRunRepository;
	private readonly channelConfigs: NotificationChannelConfigsRepository;
	private readonly notificationRecipients: BackendUserNotificationRecipientsRepository;
	private readonly systemManagedTasks: SystemManagedTaskService;
	private readonly pageSourceRefreshPolicy: PageSourceRefreshPolicyService;

	public constructor(
		private readonly db: AppDatabase,
		private readonly siteRegistry: SiteRegistry,
	) {
		this.scheduledTasks = new ScheduledTaskRepository(db, {
			retentionCountMax: RETENTION_COUNT_MAX,
		});
		this.taskRuns = new TaskRunRepository(db);
		this.channelConfigs = new NotificationChannelConfigsRepository(db);
		this.notificationRecipients =
			new BackendUserNotificationRecipientsRepository(db);
		this.systemManagedTasks = new SystemManagedTaskService(db, siteRegistry);
		this.pageSourceRefreshPolicy = new PageSourceRefreshPolicyService(
			db,
			siteRegistry,
		);
	}

	public listDefinitions() {
		return {
			items: this.registry.list().map((definition) => ({
				type: definition.type,
				label: definition.label,
				description: definition.description,
				category: definition.category,
				scope: definition.scope,
				permissions: definition.permissions,
				defaultPayload: definition.defaultPayload,
				defaultPolicy: definition.defaultPolicy,
				schedule: definition.schedule,
				dangerous: definition.dangerous ?? false,
				reuse: definition.reuse,
			})),
		};
	}

	public async listScheduled(session: AuthenticatedAdminSession) {
		const visibilitySession = toVisibilitySession(session);
		const items = (await this.scheduledTasks.list({ limit: 200, offset: 0 }))
			.map((task) =>
				projectScheduledTaskForSession(task, { session: visibilitySession }),
			)
			.filter((item) => item !== null);
		return { items, totalCount: items.length };
	}

	public async getScheduled(id: string, session: AuthenticatedAdminSession) {
		const task = await this.scheduledTasks.get(id);
		if (!task) {
			throw new ResourceNotFoundError(
				"SCHEDULED_TASK_NOT_FOUND",
				"任务不存在。",
			);
		}
		const projected = projectScheduledTaskForSession(task, {
			session: toVisibilitySession(session),
		});
		if (!projected) {
			throw new ResourceNotFoundError(
				"SCHEDULED_TASK_NOT_FOUND",
				"任务不存在。",
			);
		}
		return projected;
	}

	public async createScheduled(
		input: ScheduledTaskWriteInput,
		session: AuthenticatedAdminSession,
		requestId?: string,
	) {
		const normalized = this.validateWriteInput(input, session);
		await this.assertPageSourceRefreshAllowed({
			type: normalized.type,
			siteKey: input.siteKey,
			payload: normalized.payload,
		});
		await this.validateFailureNotificationPolicy(
			normalized.policy,
			normalized.siteId,
		);
		const task = await this.scheduledTasks.create({
			...normalized,
			ownerUserId: session.user.id,
			createdByUserId: session.user.id,
			updatedByUserId: session.user.id,
		});
		await this.writeAudit(session, "task.scheduled.create", task, {
			requestId,
		});
		return projectScheduledTaskForSession(task, {
			session: toVisibilitySession(session),
		});
	}

	public async updateScheduled(
		id: string,
		input: ScheduledTaskWriteInput,
		session: AuthenticatedAdminSession,
		requestId?: string,
	) {
		const task = await this.getTaskForManage(id, session);
		this.assertProtectedUpdateAllowed(task, input);
		const merged = {
			name: input.name ?? task.name,
			description:
				input.description === undefined ? task.description : input.description,
			type: input.type ?? task.type,
			siteKey: task.siteId ? this.siteKeyForId(task.siteId) : null,
			scopeKind: input.scopeKind ?? task.scopeKind,
			scope: input.scope ?? task.scope,
			enabled: input.enabled ?? task.enabled,
			scheduleKind: input.scheduleKind ?? task.scheduleKind,
			schedulePreset:
				input.schedulePreset === undefined
					? task.schedulePreset
					: input.schedulePreset,
			cronExpression:
				input.cronExpression === undefined
					? task.cronExpression
					: input.cronExpression,
			timezone: input.timezone === undefined ? task.timezone : input.timezone,
			payload: input.payload ?? task.payload,
			policy: input.policy ?? task.policy,
			trigger: input.trigger ?? task.trigger,
			retentionCount: input.retentionCount ?? task.retentionCount,
		};
		const normalized = this.validateWriteInput(merged, session);
		await this.assertPageSourceRefreshAllowed({
			type: normalized.type,
			siteKey: merged.siteKey,
			systemKey: task.systemKey,
			payload: normalized.payload,
		});
		await this.validateFailureNotificationPolicy(
			normalized.policy,
			normalized.siteId,
		);
		const updated = await this.scheduledTasks.update(id, {
			name: normalized.name,
			description: normalized.description,
			siteId: normalized.siteId,
			scopeKind: normalized.scopeKind,
			scope: normalized.scope,
			enabled: normalized.enabled,
			disabledReason: normalized.enabled ? null : "manual_disabled",
			scheduleKind: normalized.scheduleKind,
			schedulePreset: normalized.schedulePreset,
			cronExpression: normalized.cronExpression,
			timezone: normalized.timezone,
			payload: normalized.payload,
			policy: normalized.policy,
			trigger: normalized.trigger,
			nextRunAt: normalized.nextRunAt,
			retentionCount: normalized.retentionCount,
			updatedByUserId: session.user.id,
		});
		await this.writeAudit(session, "task.scheduled.update", updated, {
			requestId,
		});
		return projectScheduledTaskForSession(updated, {
			session: toVisibilitySession(session),
		});
	}

	public async runScheduled(
		id: string,
		session: AuthenticatedAdminSession,
		requestId?: string,
	) {
		const task = await this.getTaskForRun(id, session);
		await this.assertPageSourceRefreshAllowed({
			type: task.type,
			siteKey: task.siteId ? this.siteKeyForId(task.siteId) : null,
			systemKey: task.systemKey,
			payload: task.payload,
		});
		const run = await this.taskRuns.createScheduledTaskRun({
			scheduledTask: task,
			trigger: "manual",
			triggerSnapshot: {
				actorType: "admin_user",
				actorId: session.user.id,
			},
			input: task.payload,
			category: this.registry.get(task.type)?.category ?? "maintenance",
			createdByUserId: session.user.id,
		});
		await this.scheduledTasks.updateLastRun(task.id, {
			lastRunAt: run.createdAt,
			lastRunId: run.id,
			lastStatus: run.status,
		});
		await this.taskRuns.pruneScheduledTaskRuns({
			scheduledTaskId: task.id,
			retainCount: task.retentionCount,
		});
		await this.writeAudit(session, "task.scheduled.run", task, {
			runId: run.id,
			runStatus: run.status,
			requestId,
		});
		return projectTaskRunForSession(run, {
			session: toVisibilitySession(session),
		});
	}

	public async createManualRun(
		input: ManualTaskRunInput,
		session: AuthenticatedAdminSession,
		requestId?: string,
	) {
		const definition = this.registry.get(input.type);
		if (!definition) {
			throw new ValidationFailedError([
				validationField("type", "任务类型不存在。"),
			]);
		}
		const parsedPayload = definition.payloadSchema.safeParse(input.payload);
		if (!parsedPayload.success) {
			throw new ValidationFailedError(
				toValidationFields(
					parsedPayload.error.issues as z.core.$ZodIssue[],
					input.payload,
				).map((field) => ({ ...field, path: `payload.${field.path}` })),
			);
		}
		const payload = parsedPayload.data as Record<string, unknown>;
		await this.assertPageSourceRefreshAllowed({
			type: definition.type,
			siteKey: input.siteKey,
			payload,
		});
		const payloadSiteKey =
			typeof payload.siteKey === "string" ? payload.siteKey : input.siteKey;
		const site =
			typeof payloadSiteKey === "string"
				? this.siteRegistry.getRegisteredSite(payloadSiteKey)
				: undefined;
		if (payloadSiteKey && !site) {
			throw new ValidationFailedError([
				validationField("siteKey", "站点不存在。"),
			]);
		}
		if (
			site &&
			!session.isAdmin &&
			!session.isInitialAdmin &&
			!session.siteIds.includes(site.id)
		) {
			throw new AppError(403, "ADMIN_SITE_ACCESS_REQUIRED", "没有该站点权限。");
		}
		const run = await this.taskRuns.create({
			type: definition.type,
			category: definition.category,
			siteId: site?.id ?? null,
			siteKey: site?.siteKey ?? null,
			actorType: "admin_user",
			actorId: String(session.user.id),
			trigger: "manual",
			triggerSnapshot: {
				actorType: "admin_user",
				actorId: session.user.id,
			},
			scopeKind: definition.scope,
			scope: site ? { siteKey: site.siteKey } : {},
			payloadSummary: {
				type: definition.type,
				siteKey: site?.siteKey ?? null,
			},
			payload,
			input: payload,
			runAfter: input.runAfter ?? null,
			maxAttempts: input.maxAttempts ?? definition.defaultPolicy.maxAttempts,
			retryDelaySec:
				input.retryDelaySec ?? definition.defaultPolicy.retryDelaySec,
			priority: input.priority ?? 0,
			concurrencyKey: input.concurrencyKey ?? null,
			ownerUserIdSnapshot: session.user.id,
			createdByUserId: session.user.id,
		});
		await this.writeRunAudit(session, "task.run.create_manual", run, {
			requestId,
		});
		return projectTaskRunForSession(run, {
			session: toVisibilitySession(session),
		});
	}

	public async deleteScheduled(
		id: string,
		reason: string | null,
		session: AuthenticatedAdminSession,
		requestId?: string,
	) {
		const task = await this.getTaskForManage(id, session);
		await this.assertProtectedOperationAllowed(
			task,
			"delete",
			session,
			requestId,
		);
		const snapshot = await this.scheduledTasks.deleteWithSnapshot(id, {
			deletedByUserId: session.user.id,
			deleteReason: reason,
		});
		await this.writeAudit(session, "task.scheduled.delete", task, {
			requestId,
		});
		return projectDeletedSnapshotForSession(snapshot);
	}

	public async enableScheduled(
		id: string,
		session: AuthenticatedAdminSession,
		requestId?: string,
	) {
		const task = await this.getTaskForManage(id, session);
		await this.assertPageSourceRefreshAllowed({
			type: task.type,
			siteKey: task.siteId ? this.siteKeyForId(task.siteId) : null,
			systemKey: task.systemKey,
			payload: task.payload,
		});
		const updated = await this.scheduledTasks.enable(task.id, {
			updatedByUserId: session.user.id,
		});
		await this.writeAudit(session, "task.scheduled.enable", updated, {
			requestId,
		});
		return projectScheduledTaskForSession(updated, {
			session: toVisibilitySession(session),
		});
	}

	public async disableScheduled(
		id: string,
		reason: string,
		session: AuthenticatedAdminSession,
		requestId?: string,
	) {
		const task = await this.getTaskForManage(id, session);
		await this.assertProtectedOperationAllowed(
			task,
			"disable",
			session,
			requestId,
		);
		const updated = await this.scheduledTasks.disable(task.id, {
			reason,
			updatedByUserId: session.user.id,
		});
		await this.writeAudit(session, "task.scheduled.disable", updated, {
			requestId,
		});
		return projectScheduledTaskForSession(updated, {
			session: toVisibilitySession(session),
		});
	}

	public async transferOwner(
		id: string,
		ownerUserId: number,
		session: AuthenticatedAdminSession,
		requestId?: string,
	) {
		const task = await this.getTaskForManage(id, session);
		await this.assertProtectedOperationAllowed(
			task,
			"transfer_owner",
			session,
			requestId,
		);
		await this.assertCanOwnTask(ownerUserId, task);
		const updated = await this.scheduledTasks.update(task.id, {
			ownerUserId,
			transferredByUserId: session.user.id,
			transferredAt: new Date().toISOString(),
			updatedByUserId: session.user.id,
		});
		await this.writeAudit(session, "task.scheduled.transfer_owner", updated, {
			requestId,
		});
		return projectScheduledTaskForSession(updated, {
			session: toVisibilitySession(session),
		});
	}

	public async reconcileOwner(
		ownerUserId: number,
		reason: string,
		session: AuthenticatedAdminSession,
		requestId?: string,
	) {
		if (!session.isInitialAdmin && !session.isAdmin) {
			throw new AppError(403, "ADMIN_PERMISSION_REQUIRED", "缺少后台权限。");
		}
		const initialAdmin = await this.getInitialAdmin();
		const tasks = await this.scheduledTasks.list({ limit: 500, offset: 0 });
		const updatedTaskIds: string[] = [];
		for (const task of tasks) {
			if (task.ownerUserId !== ownerUserId) {
				continue;
			}
			if (task.systemKey && task.protection) {
				continue;
			}
			const updated = await this.scheduledTasks.update(task.id, {
				enabled: false,
				disabledReason: reason,
				ownerUserId: initialAdmin.id,
				transferredByUserId: session.user.id,
				transferredAt: new Date().toISOString(),
				updatedByUserId: session.user.id,
			});
			updatedTaskIds.push(updated.id);
			await this.writeAudit(
				session,
				"task.scheduled.owner_reconcile",
				updated,
				{
					requestId,
				},
			);
		}
		return { updatedTaskIds };
	}

	public async ensureAuthoritativePageSourceRefreshTask(input: {
		siteKey: string;
		sitemapUrls: string[];
		session?: AuthenticatedAdminSession;
		actorUserId?: number;
		requestId?: string;
		timeoutMs?: number;
		maxBytes?: number;
		maxAttempts?: number;
		retryDelaySec?: number;
	}) {
		const ensured =
			await this.systemManagedTasks.ensureAuthoritativePageSourceRefresh({
				siteKey: input.siteKey,
				sitemapUrls: input.sitemapUrls,
				actorUserId: input.session?.user.id ?? input.actorUserId ?? null,
				timeoutMs: input.timeoutMs,
				maxBytes: input.maxBytes,
				maxAttempts: input.maxAttempts,
				retryDelaySec: input.retryDelaySec,
			});
		await this.writeAudit(
			input.session,
			`task.scheduled.system_${ensured.action}`,
			ensured.task,
			{
				requestId: input.requestId,
				systemKey: ensured.task.systemKey ?? undefined,
				protectionKind: ensured.task.protection?.kind,
				actorUserId: input.actorUserId,
			},
		);
		return ensured;
	}

	public async disableAuthoritativePageSourceRefreshTask(input: {
		siteKey: string;
		session?: AuthenticatedAdminSession;
		actorUserId?: number;
		requestId?: string;
	}) {
		const task =
			await this.systemManagedTasks.disableAuthoritativePageSourceRefresh({
				siteKey: input.siteKey,
				actorUserId: input.session?.user.id ?? input.actorUserId ?? null,
			});
		if (task) {
			await this.writeAudit(
				input.session,
				"task.scheduled.system_disabled",
				task,
				{
					requestId: input.requestId,
					systemKey: task.systemKey ?? undefined,
					protectionKind: "authoritative_page_source_refresh",
					actorUserId: input.actorUserId,
				},
			);
		}
		return task;
	}

	public async listRuns(session: AuthenticatedAdminSession) {
		const result = await this.taskRuns.listForTaskCenter({
			limit: 200,
			offset: 0,
		});
		const visibilitySession = toVisibilitySession(session);
		const items = result.items
			.map((run) =>
				projectTaskRunForSession(run, { session: visibilitySession }),
			)
			.filter((item) => item !== null);
		return { items, totalCount: items.length };
	}

	public async getRun(id: string, session: AuthenticatedAdminSession) {
		const run = await this.taskRuns.get(id);
		if (!run) {
			throw new ResourceNotFoundError("TASK_RUN_NOT_FOUND", "任务运行不存在。");
		}
		const projected = projectTaskRunForSession(run, {
			session: toVisibilitySession(session),
		});
		if (!projected) {
			throw new ResourceNotFoundError("TASK_RUN_NOT_FOUND", "任务运行不存在。");
		}
		return projected;
	}

	public async assertCanViewRunLogs(
		id: string,
		session: AuthenticatedAdminSession,
	) {
		const run = await this.taskRuns.getRequired(id);
		if (!canViewTaskLogs(run, toVisibilitySession(session))) {
			throw new AppError(403, "TASK_LOG_ACCESS_DENIED", "没有任务日志权限。");
		}
		return run;
	}

	public async cancelRun(
		id: string,
		session: AuthenticatedAdminSession,
		requestId?: string,
	) {
		await this.assertCanViewRunLogs(id, session);
		const cancelled = await this.taskRuns.cancel(id, {
			code: "TASK_RUN_CANCELLED",
			reason: "manual_cancel",
			cancelledByUserId: session.user.id,
		});
		await this.writeRunAudit(session, "task.run.cancel", cancelled, {
			requestId,
		});
		return projectTaskRunForSession(cancelled, {
			session: toVisibilitySession(session),
		});
	}

	public async retryRun(
		id: string,
		session: AuthenticatedAdminSession,
		requestId?: string,
	) {
		await this.assertCanViewRunLogs(id, session);
		const runAfter = new Date().toISOString();
		const retrying = await this.taskRuns.markRetrying(
			id,
			{
				code: "TASK_RUN_RETRY_REQUESTED",
				retryByUserId: session.user.id,
			},
			runAfter,
		);
		await this.writeRunAudit(session, "task.run.retry", retrying, {
			requestId,
		});
		return projectTaskRunForSession(retrying, {
			session: toVisibilitySession(session),
		});
	}

	public async listAudit(session: AuthenticatedAdminSession) {
		const rows = await this.db
			.select()
			.from(auditLogs)
			.where(
				and(
					session.isAdmin || session.isInitialAdmin
						? undefined
						: eq(auditLogs.actorType, "admin_user"),
				),
			)
			.orderBy(desc(auditLogs.createdAt))
			.limit(200);
		const visibleRows = rows.filter((row) => {
			if (!row.action.startsWith("task.")) {
				return false;
			}
			if (session.isAdmin || session.isInitialAdmin) {
				return true;
			}
			return row.siteId !== null && session.siteIds.includes(row.siteId);
		});
		return {
			items: visibleRows.map((row) => {
				const payload = this.parseAuditPayload(row.payloadJson);
				return {
					id: row.id,
					siteId: row.siteId,
					actorType: row.actorType,
					actorId: row.actorId,
					action: row.action,
					targetType: row.targetType,
					targetId: row.targetId,
					taskName: payload.taskName,
					taskType: payload.taskType,
					siteKey: payload.siteKey,
					runId:
						payload.runId ??
						(row.targetType === "task_run" ? row.targetId : null),
					runStatus: payload.runStatus,
					requestId: payload.requestId,
					scheduledTaskId:
						payload.scheduledTaskId ??
						(row.targetType === "scheduled_task" ? row.targetId : null),
					createdAt: row.createdAt,
				};
			}),
			totalCount: visibleRows.length,
		};
	}

	public async listDeletedSnapshots(session: AuthenticatedAdminSession) {
		this.assertCanViewDeletedSnapshots(session);
		const items = await this.scheduledTasks.listDeletedSnapshots({
			limit: 200,
			offset: 0,
		});
		return {
			items: items.map(projectDeletedSnapshotForSession),
			totalCount: items.length,
		};
	}

	public async getDeletedSnapshot(
		id: string,
		session: AuthenticatedAdminSession,
	) {
		this.assertCanViewDeletedSnapshots(session);
		const snapshot = await this.scheduledTasks.getDeletedSnapshot(id);
		if (!snapshot) {
			throw new ResourceNotFoundError(
				"SCHEDULED_TASK_DELETED_SNAPSHOT_NOT_FOUND",
				"任务删除快照不存在。",
			);
		}
		return projectDeletedSnapshotForSession(snapshot);
	}

	private async assertPageSourceRefreshAllowed(input: {
		type: string;
		siteKey?: string | null;
		systemKey?: string | null;
		payload?: unknown;
	}) {
		if (input.type !== "page_source_refresh") {
			return;
		}
		const siteKey =
			input.siteKey ?? readPageSourceRefreshSiteKey(input.payload);
		if (!siteKey) {
			return;
		}
		const result = await this.pageSourceRefreshPolicy.checkRefreshAllowed({
			siteKey,
			systemKey: input.systemKey,
			payload: input.payload,
		});
		if (result === "ok") {
			return;
		}
		throw new AppError(
			409,
			"AUTHORITATIVE_PAGE_SOURCE_REFRESH_CONFLICT",
			"权威模式已由系统托管任务负责同站点页面来源刷新。",
			{
				siteKey,
			},
		);
	}

	private validateWriteInput(
		input: ScheduledTaskWriteInput,
		session: AuthenticatedAdminSession,
	) {
		const fields = [];
		if (!input.name || typeof input.name !== "string") {
			fields.push(validationField("name", "任务名称不能为空。"));
		}
		if (!input.type || typeof input.type !== "string") {
			fields.push(validationField("type", "任务类型不能为空。"));
		}
		const definition =
			typeof input.type === "string" ? this.registry.get(input.type) : null;
		if (input.type && !definition) {
			fields.push(validationField("type", "任务类型不存在。"));
		}
		const site =
			typeof input.siteKey === "string"
				? this.siteRegistry.getRegisteredSite(input.siteKey)
				: undefined;
		if (input.scopeKind === "site" && !site) {
			fields.push(validationField("siteKey", "站点不存在。"));
		}
		if (
			site &&
			!session.isAdmin &&
			!session.isInitialAdmin &&
			!session.siteIds.includes(site.id)
		) {
			throw new AppError(403, "ADMIN_SITE_ACCESS_REQUIRED", "没有该站点权限。");
		}
		if (definition) {
			const parsed = definition.payloadSchema.safeParse(input.payload);
			if (!parsed.success) {
				fields.push(
					...toValidationFields(
						parsed.error.issues as z.core.$ZodIssue[],
						input.payload,
					).map((field) => ({ ...field, path: `payload.${field.path}` })),
				);
			}
			if (definition.dangerous && input.enabled) {
				fields.push(
					validationField(
						"enabled",
						"危险任务必须先以禁用状态创建，确认后再手动启用。",
					),
				);
			}
			if (
				definition.type === "blacklist_automation" &&
				input.scopeKind === "global" &&
				!session.isAdmin &&
				!session.isInitialAdmin
			) {
				fields.push(
					validationField(
						"scopeKind",
						"全局黑名单自动化只允许全局管理员或初始管理员创建。",
					),
				);
			}
		}
		try {
			validateScheduleDefinition({
				scheduleKind: input.scheduleKind ?? "",
				schedulePreset: input.schedulePreset,
				cronExpression: input.cronExpression,
				trigger: input.trigger,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			fields.push(validationField("trigger.everyMinutes", message));
		}
		if (fields.length > 0) {
			throw new ValidationFailedError(fields);
		}
		const nextRunAt =
			calculateNextRunAt({
				scheduleKind: input.scheduleKind ?? "manual_only",
				schedulePreset: input.schedulePreset,
				cronExpression: input.cronExpression,
				trigger: input.trigger,
				now: new Date(),
			})?.toISOString() ?? null;
		return {
			name: String(input.name),
			description: input.description ?? null,
			type: String(input.type),
			siteId: site?.id ?? null,
			scopeKind: input.scopeKind ?? "global",
			scope: input.scope ?? {},
			enabled: input.enabled ?? false,
			disabledReason: input.enabled === false ? "manual_disabled" : null,
			scheduleKind: input.scheduleKind ?? "manual_only",
			schedulePreset: input.schedulePreset ?? null,
			cronExpression: input.cronExpression ?? null,
			timezone: input.timezone ?? null,
			payload: input.payload,
			policy: input.policy ?? {},
			trigger: input.trigger ?? {},
			nextRunAt,
			retentionCount: Math.min(
				Math.max(input.retentionCount ?? 5, 0),
				RETENTION_COUNT_MAX,
			),
		};
	}

	private async validateFailureNotificationPolicy(
		policy: unknown,
		siteId: number | null,
	) {
		const fields = [];
		const failureNotification =
			policy &&
			typeof policy === "object" &&
			"failureNotification" in policy &&
			(policy as Record<string, unknown>).failureNotification &&
			typeof (policy as Record<string, unknown>).failureNotification ===
				"object"
				? ((policy as Record<string, unknown>).failureNotification as Record<
						string,
						unknown
					>)
				: null;
		if (!failureNotification?.enabled) {
			return;
		}
		if (!siteId) {
			fields.push(
				validationField(
					"policy.failureNotification.enabled",
					"失败通知只支持站点范围任务。",
				),
			);
		}
		const channelConfigIds = Array.isArray(failureNotification.channelConfigIds)
			? failureNotification.channelConfigIds.filter(
					(item): item is string => typeof item === "string" && item.length > 0,
				)
			: [];
		const recipientIds = Array.isArray(failureNotification.recipientIds)
			? failureNotification.recipientIds.filter(
					(item): item is string => typeof item === "string" && item.length > 0,
				)
			: [];
		if (channelConfigIds.length === 0) {
			fields.push(
				validationField(
					"policy.failureNotification.channelConfigIds",
					"失败通知需要选择至少一个通知通道。",
				),
			);
		}
		if (recipientIds.length === 0) {
			fields.push(
				validationField(
					"policy.failureNotification.recipientIds",
					"失败通知需要选择至少一个接收人。",
				),
			);
		}
		const channelConfigs =
			await this.channelConfigs.listByIds(channelConfigIds);
		const channelConfigById = new Map(
			channelConfigs.map((config) => [config.id, config]),
		);
		for (const channelConfigId of channelConfigIds) {
			const config = channelConfigById.get(channelConfigId);
			if (!config?.enabled) {
				fields.push(
					validationField(
						"policy.failureNotification.channelConfigIds",
						"通知通道不存在或未启用。",
					),
				);
				break;
			}
		}
		if (siteId) {
			const recipients =
				await this.notificationRecipients.listSiteRecipients(siteId);
			const recipientById = new Map(
				recipients.map((recipient) => [recipient.id, recipient]),
			);
			for (const recipientId of recipientIds) {
				const recipient = recipientById.get(recipientId);
				if (!recipient?.enabled) {
					fields.push(
						validationField(
							"policy.failureNotification.recipientIds",
							"通知接收人不存在或未启用。",
						),
					);
					break;
				}
			}
		}
		if (fields.length > 0) {
			throw new ValidationFailedError(fields);
		}
	}

	private assertCanViewDeletedSnapshots(session: AuthenticatedAdminSession) {
		if (!session.isInitialAdmin) {
			throw new AppError(
				403,
				"TASK_DELETED_SNAPSHOT_ACCESS_DENIED",
				"只有初始管理员可以查看任务删除快照。",
			);
		}
	}

	private parseAuditPayload(value: string | null) {
		if (!value) {
			return {} as Record<string, unknown>;
		}
		try {
			const parsed = JSON.parse(value) as unknown;
			return parsed && typeof parsed === "object"
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	}

	private async getTaskForManage(
		id: string,
		session: AuthenticatedAdminSession,
	): Promise<ScheduledTaskRecord> {
		const task = await this.scheduledTasks.get(id);
		if (!task) {
			throw new ResourceNotFoundError(
				"SCHEDULED_TASK_NOT_FOUND",
				"任务不存在。",
			);
		}
		if (!canManageScheduledTask(task, toVisibilitySession(session))) {
			throw new AppError(
				403,
				"SCHEDULED_TASK_MANAGE_DENIED",
				"没有任务管理权限。",
			);
		}
		return task;
	}

	private async assertProtectedOperationAllowed(
		task: ScheduledTaskRecord,
		operation: ProtectedTaskOperation,
		session: AuthenticatedAdminSession,
		requestId?: string,
	) {
		const policy = task.protection;
		if (!policy) {
			return;
		}
		const blocked =
			(operation === "delete" && policy.lockedDelete) ||
			(operation === "disable" && policy.lockedDisable) ||
			(operation === "transfer_owner" && policy.lockedOwnerTransfer);
		if (!blocked) {
			return;
		}
		await this.writeAudit(
			session,
			"task.scheduled.protected_operation_denied",
			task,
			{
				requestId,
				systemKey: task.systemKey ?? undefined,
				protectionKind: policy.kind,
				deniedOperation: operation,
			},
		);
		throw new AppError(
			operation === "transfer_owner" ? 409 : 409,
			operation === "transfer_owner"
				? "SYSTEM_TASK_OWNER_IMMUTABLE"
				: "SCHEDULED_TASK_PROTECTED",
			protectedOperationReason(policy, operation),
			{
				systemKey: task.systemKey,
				protectionKind: policy.kind,
				operation,
			},
		);
	}

	private assertProtectedUpdateAllowed(
		task: ScheduledTaskRecord,
		input: ScheduledTaskWriteInput,
	) {
		const policy = task.protection;
		if (!policy) {
			return;
		}
		const fields: Array<{ path: string; message: string }> = [];
		const siteKey = task.siteId ? this.siteKeyForId(task.siteId) : null;
		if (
			policy.lockedType &&
			input.type !== undefined &&
			input.type !== task.type
		) {
			fields.push({ path: "type", message: "系统托管任务不能修改任务类型。" });
		}
		if (
			policy.lockedSite &&
			input.siteKey !== undefined &&
			input.siteKey !== siteKey
		) {
			fields.push({
				path: "siteKey",
				message: "系统托管任务不能修改所属站点。",
			});
		}
		if (
			policy.lockedSite &&
			input.scopeKind !== undefined &&
			input.scopeKind !== task.scopeKind
		) {
			fields.push({
				path: "scopeKind",
				message: "系统托管任务不能修改任务范围。",
			});
		}
		if (
			policy.lockedSite &&
			input.scope !== undefined &&
			!isJsonEqual(input.scope, task.scope)
		) {
			fields.push({ path: "scope", message: "系统托管任务不能修改任务范围。" });
		}
		if (policy.lockedDisable && input.enabled === false && task.enabled) {
			fields.push({ path: "enabled", message: "系统托管任务不能停用。" });
		}
		if (input.payload !== undefined) {
			if (!isRecord(input.payload) || !isRecord(task.payload)) {
				fields.push({ path: "payload", message: "任务 payload 格式无效。" });
			} else {
				for (const path of policy.lockedPayloadPaths ?? []) {
					if (
						!isJsonEqual(
							readPath(input.payload, path),
							readPath(task.payload, path),
						)
					) {
						fields.push({
							path: `payload.${path}`,
							message: "系统托管任务的受保护 payload 字段不能修改。",
						});
					}
				}
				let allowedPayload = structuredClone(task.payload);
				for (const path of policy.editablePayloadPaths ?? []) {
					const value = readPath(input.payload, path);
					if (value !== undefined) {
						allowedPayload = setPath(allowedPayload, path, value);
					}
				}
				if (!isJsonEqual(input.payload, allowedPayload)) {
					fields.push({
						path: "payload",
						message: "系统托管任务只能修改白名单 payload 字段。",
					});
				}
			}
		}
		const editableFields = new Set(policy.editableFields ?? []);
		const guardedFields: Array<keyof ScheduledTaskWriteInput> = [
			"name",
			"description",
			"scheduleKind",
			"schedulePreset",
			"cronExpression",
			"timezone",
			"trigger",
			"policy",
			"retentionCount",
		];
		for (const field of guardedFields) {
			if (
				input[field] !== undefined &&
				!editableFields.has(field) &&
				!isJsonEqual(input[field], task[field as keyof ScheduledTaskRecord])
			) {
				fields.push({
					path: field,
					message: "系统托管任务的该字段不允许修改。",
				});
			}
		}
		if (fields.length > 0) {
			throw new AppError(
				409,
				"SCHEDULED_TASK_PROTECTED_FIELD",
				protectedOperationReason(policy, "update"),
				{
					fields,
					systemKey: task.systemKey,
					protectionKind: policy.kind,
				},
			);
		}
	}

	private async getTaskForRun(
		id: string,
		session: AuthenticatedAdminSession,
	): Promise<ScheduledTaskRecord> {
		const task = await this.scheduledTasks.get(id);
		if (!task) {
			throw new ResourceNotFoundError(
				"SCHEDULED_TASK_NOT_FOUND",
				"任务不存在。",
			);
		}
		if (!canRunScheduledTask(task, toVisibilitySession(session))) {
			throw new AppError(
				403,
				"SCHEDULED_TASK_RUN_DENIED",
				"没有任务执行权限。",
			);
		}
		return task;
	}

	private siteKeyForId(siteId: number): string | null {
		return (
			this.siteRegistry.listRegisteredSites().find((site) => site.id === siteId)
				?.siteKey ?? null
		);
	}

	private async assertCanOwnTask(
		ownerUserId: number,
		task: ScheduledTaskRecord,
	) {
		const [user] = await this.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.id, ownerUserId));
		if (!user || user.status !== "active" || user.deletedAt) {
			throw new AppError(400, "TASK_OWNER_INVALID", "目标 owner 不可用。");
		}
		if (user.isInitialAdmin) {
			return;
		}
		const [group] = await this.db
			.select({ key: adminGroups.key })
			.from(adminUserGroups)
			.innerJoin(adminGroups, eq(adminUserGroups.groupId, adminGroups.id))
			.where(eq(adminUserGroups.userId, ownerUserId));
		if (group?.key === "admin") {
			return;
		}
		if (group?.key !== "site_admin" || !task.siteId) {
			throw new AppError(400, "TASK_OWNER_INVALID", "目标 owner 权限不足。");
		}
		const [access] = await this.db
			.select()
			.from(adminUserSiteAccess)
			.where(
				and(
					eq(adminUserSiteAccess.userId, ownerUserId),
					eq(adminUserSiteAccess.siteId, task.siteId),
				),
			)
			.limit(1);
		if (!access) {
			throw new AppError(400, "TASK_OWNER_INVALID", "目标 owner 无站点权限。");
		}
	}

	private async getInitialAdmin() {
		const [user] = await this.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.isInitialAdmin, true))
			.limit(1);
		if (!user) {
			throw new ResourceNotFoundError(
				"INITIAL_ADMIN_NOT_FOUND",
				"初始管理员不存在。",
			);
		}
		return user;
	}

	private async writeAudit(
		session: AuthenticatedAdminSession | undefined,
		action: string,
		task: Pick<
			ScheduledTaskRecord,
			"id" | "siteId" | "type" | "name" | "systemKey" | "protection"
		>,
		metadata: {
			requestId?: string;
			runId?: string;
			runStatus?: TaskRunRecord["status"];
			systemKey?: string;
			protectionKind?: string;
			deniedOperation?: string;
			actorUserId?: number;
		} = {},
	) {
		const siteKey =
			task.siteId === null
				? undefined
				: (this.siteKeyForId(task.siteId) ?? undefined);
		await this.db.insert(auditLogs).values({
			siteId: task.siteId,
			actorType: session || metadata.actorUserId ? "admin_user" : "system",
			actorId: session
				? String(session.user.id)
				: metadata.actorUserId
					? String(metadata.actorUserId)
					: null,
			action,
			targetType: "scheduled_task",
			targetId: task.id,
			payloadJson: JSON.stringify({
				taskName: task.name,
				taskType: task.type,
				siteKey,
				systemKey: metadata.systemKey ?? task.systemKey,
				protectionKind: metadata.protectionKind ?? task.protection?.kind,
				deniedOperation: metadata.deniedOperation,
				requestId: metadata.requestId,
				runId: metadata.runId,
				runStatus: metadata.runStatus,
			}),
		});
	}

	private async writeRunAudit(
		session: AuthenticatedAdminSession,
		action: string,
		run: TaskRunRecord,
		metadata: { requestId?: string } = {},
	) {
		await this.db.insert(auditLogs).values({
			siteId: run.siteId,
			actorType: "admin_user",
			actorId: String(session.user.id),
			action,
			targetType: "task_run",
			targetId: run.id,
			payloadJson: JSON.stringify({
				scheduledTaskId: run.scheduledTaskId,
				taskName: run.scheduledTaskNameSnapshot,
				taskType: run.type,
				siteKey: run.siteKey,
				runId: run.id,
				runStatus: run.status,
				requestId: metadata.requestId,
			}),
		});
	}
}
