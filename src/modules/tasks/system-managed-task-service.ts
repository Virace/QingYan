import type { AppDatabase } from "../../db/client";
import type { SiteRegistry } from "../shared/site-registry";
import { createBuiltInTaskTypeRegistry } from "./built-in-task-types";
import {
	isJsonEqual,
	readPath,
	setPath,
	type ProtectedTaskPolicy,
} from "./protected-task-policy";
import {
	calculateNextRunAt,
	validateScheduleDefinition,
} from "./schedule-calculator";
import { ScheduledTaskRepository } from "./scheduled-task-repository";
import { SystemPrincipalService } from "./system-principal";

export type SystemManagedEnsureAction =
	| "created"
	| "unchanged"
	| "repaired"
	| "reenabled";

export interface EnsureSystemManagedScheduledTaskInput {
	systemKey: string;
	protection: ProtectedTaskPolicy;
	type: string;
	siteKey: string;
	payload: Record<string, unknown>;
	scope?: Record<string, unknown>;
	trigger?: Record<string, unknown>;
	scheduleKind?: string;
	schedulePreset?: string | null;
	cronExpression?: string | null;
	timezone?: string | null;
	policy?: Record<string, unknown>;
	retentionCount?: number;
	name?: string;
	description?: string | null;
	actorUserId?: number | null;
}

function pickAllowedExistingFields(
	existing: Awaited<ReturnType<ScheduledTaskRepository["getBySystemKey"]>>,
	input: EnsureSystemManagedScheduledTaskInput,
) {
	const editable = new Set(input.protection.editableFields ?? []);
	return {
		name: editable.has("name") ? (existing?.name ?? input.name) : input.name,
		description: editable.has("description")
			? (existing?.description ?? input.description)
			: input.description,
		scheduleKind: editable.has("scheduleKind")
			? (existing?.scheduleKind ?? input.scheduleKind)
			: input.scheduleKind,
		schedulePreset: editable.has("schedulePreset")
			? (existing?.schedulePreset ?? input.schedulePreset)
			: input.schedulePreset,
		cronExpression: editable.has("cronExpression")
			? (existing?.cronExpression ?? input.cronExpression)
			: input.cronExpression,
		timezone: editable.has("timezone")
			? (existing?.timezone ?? input.timezone)
			: input.timezone,
		trigger: editable.has("trigger")
			? ((existing?.trigger as Record<string, unknown> | undefined) ??
				input.trigger)
			: input.trigger,
		policy: editable.has("policy")
			? ((existing?.policy as Record<string, unknown> | undefined) ??
				input.policy)
			: input.policy,
		retentionCount: editable.has("retentionCount")
			? (existing?.retentionCount ?? input.retentionCount)
			: input.retentionCount,
	};
}

function mergeEditablePayload(
	existing: unknown,
	required: Record<string, unknown>,
	policy: ProtectedTaskPolicy,
) {
	let next = { ...required };
	const existingRecord =
		existing && typeof existing === "object"
			? (existing as Record<string, unknown>)
			: {};
	for (const path of policy.editablePayloadPaths ?? []) {
		const value = readPath(existingRecord, path);
		if (value !== undefined) {
			next = setPath(next, path, value);
		}
	}
	for (const path of policy.lockedPayloadPaths ?? []) {
		next = setPath(next, path, readPath(required, path));
	}
	return next;
}

export function authoritativePageSourceRefreshSystemKey(siteKey: string) {
	return `page_registry:authoritative_source_refresh:${siteKey}`;
}

export function authoritativePageSourceRefreshPolicy(): ProtectedTaskPolicy {
	return {
		kind: "authoritative_page_source_refresh",
		managedBy: "pageRegistry.authoritative",
		lockedDelete: true,
		lockedDisable: true,
		lockedOwnerTransfer: true,
		lockedType: true,
		lockedSite: true,
		lockedPayloadPaths: ["siteKey", "sourceIds"],
		editablePayloadPaths: [
			"timeoutMs",
			"maxBytes",
			"maxAttempts",
			"retryDelaySec",
		],
		editableFields: [
			"name",
			"description",
			"scheduleKind",
			"schedulePreset",
			"cronExpression",
			"timezone",
			"trigger",
			"policy",
			"retentionCount",
		],
	};
}

export class SystemManagedTaskService {
	private readonly registry = createBuiltInTaskTypeRegistry();
	private readonly scheduledTasks: ScheduledTaskRepository;
	private readonly principals: SystemPrincipalService;

	public constructor(
		db: AppDatabase,
		private readonly siteRegistry: SiteRegistry,
	) {
		this.scheduledTasks = new ScheduledTaskRepository(db);
		this.principals = new SystemPrincipalService(db);
	}

	public async ensureAuthoritativePageSourceRefresh(input: {
		siteKey: string;
		sourceIds: number[];
		actorUserId?: number | null;
		timeoutMs?: number;
		maxBytes?: number;
		maxAttempts?: number;
		retryDelaySec?: number;
	}) {
		return this.ensureSystemManagedScheduledTask({
			systemKey: authoritativePageSourceRefreshSystemKey(input.siteKey),
			protection: authoritativePageSourceRefreshPolicy(),
			type: "page_source_refresh",
			siteKey: input.siteKey,
			name: "页面来源权威刷新",
			description: "页面来源权威模式保障任务，定时刷新权威 sitemap。",
			payload: {
				siteKey: input.siteKey,
				sourceIds: input.sourceIds,
				trigger: "scheduled",
				timeoutMs: input.timeoutMs,
				maxBytes: input.maxBytes,
				maxAttempts: input.maxAttempts,
				retryDelaySec: input.retryDelaySec,
			},
			scope: { siteKey: input.siteKey },
			trigger: { everyMinutes: 60 },
			scheduleKind: "interval",
			schedulePreset: "hourly",
			policy: {
				maxAttempts: input.maxAttempts ?? 1,
				retryDelaySec: input.retryDelaySec ?? 0,
			},
			retentionCount: 10,
			actorUserId: input.actorUserId,
		});
	}

	public async releaseAuthoritativePageSourceRefreshProtection(input: {
		siteKey: string;
		actorUserId?: number | null;
	}) {
		const existing = await this.scheduledTasks.getBySystemKey(
			authoritativePageSourceRefreshSystemKey(input.siteKey),
		);
		if (!existing) {
			return null;
		}
		return this.scheduledTasks.update(existing.id, {
			protection: null,
			updatedByUserId: input.actorUserId ?? null,
		});
	}

	public async ensureSystemManagedScheduledTask(
		input: EnsureSystemManagedScheduledTaskInput,
	): Promise<{
		action: SystemManagedEnsureAction;
		task: Awaited<ReturnType<ScheduledTaskRepository["getRequired"]>>;
	}> {
		const definition = this.registry.getRequired(input.type);
		const parsedPayload = definition.payloadSchema.parse(
			input.payload,
		) as Record<string, unknown>;
		const site = this.siteRegistry.getRegisteredSite(input.siteKey);
		if (!site) {
			throw new Error(
				`Site not found for system managed task: ${input.siteKey}`,
			);
		}
		const existing = await this.scheduledTasks.getBySystemKey(input.systemKey);
		const principal = await this.principals.ensurePageRegistryPrincipal();
		const preserved = pickAllowedExistingFields(existing, input);
		const payload = mergeEditablePayload(
			existing?.payload,
			parsedPayload,
			input.protection,
		);
		const scheduleKind = preserved.scheduleKind ?? "manual_only";
		const trigger = preserved.trigger ?? {};
		validateScheduleDefinition({
			scheduleKind,
			schedulePreset: preserved.schedulePreset,
			cronExpression: preserved.cronExpression,
			trigger,
		});
		const nextRunAt =
			calculateNextRunAt({
				scheduleKind,
				schedulePreset: preserved.schedulePreset,
				cronExpression: preserved.cronExpression,
				trigger,
				now: new Date(),
			})?.toISOString() ?? null;
		const next = {
			name: preserved.name ?? input.name ?? definition.label,
			description: preserved.description ?? input.description ?? null,
			type: input.type,
			siteId: site.id,
			scopeKind: "site",
			scope: input.scope ?? { siteKey: input.siteKey },
			enabled: true,
			disabledReason: null,
			scheduleKind,
			schedulePreset: preserved.schedulePreset ?? null,
			cronExpression: preserved.cronExpression ?? null,
			timezone: preserved.timezone ?? null,
			payload,
			policy: preserved.policy ?? input.policy ?? definition.defaultPolicy,
			trigger,
			nextRunAt,
			retentionCount: preserved.retentionCount ?? input.retentionCount ?? 5,
			ownerUserId: principal.id,
			updatedByUserId: input.actorUserId ?? null,
			systemKey: input.systemKey,
			protection: input.protection,
		};
		if (!existing) {
			const task = await this.scheduledTasks.create({
				...next,
				createdByUserId: input.actorUserId ?? null,
			});
			return { action: "created", task };
		}
		const changed =
			existing.type !== next.type ||
			existing.siteId !== next.siteId ||
			existing.ownerUserId !== next.ownerUserId ||
			existing.enabled !== true ||
			existing.systemKey !== next.systemKey ||
			!isJsonEqual(existing.protection, next.protection) ||
			!isJsonEqual(existing.scope, next.scope) ||
			!isJsonEqual(existing.payload, next.payload);
		const task = await this.scheduledTasks.update(existing.id, next);
		return {
			action:
				existing.enabled === false
					? "reenabled"
					: changed
						? "repaired"
						: "unchanged",
			task,
		};
	}
}
