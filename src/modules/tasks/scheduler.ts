import {
	calculateNextRunAt,
	validateScheduleDefinition,
} from "./schedule-calculator";
import type {
	ConditionTriggerEvaluator,
	ConditionEvaluationResult,
} from "./condition-trigger-evaluator";
import type {
	ScheduledTaskRecord,
	ScheduledTaskRepository,
} from "./scheduled-task-repository";
import type { TaskEventLogRepository } from "./task-event-log-repository";
import type { TaskRunRepository } from "./task-run-repository";
import type { TaskRunnerServices } from "./task-runner-context";
import type { TaskTypeRegistry } from "./task-type-registry";
import type { TaskRunRecord } from "./types";

export interface TaskSchedulerOptions {
	scheduledTasks: ScheduledTaskRepository;
	taskRuns: TaskRunRepository;
	eventLogs: TaskEventLogRepository;
	workerId: string;
	registry?: TaskTypeRegistry;
	services?: TaskRunnerServices;
	conditionEvaluator?: ConditionTriggerEvaluator;
	failureNotifications?: {
		planForFailedRun(run: TaskRunRecord): Promise<unknown>;
	};
	intervalMs?: number;
	claimLeaseMs?: number;
	staleAfterMs?: number;
	now?: () => Date;
}

export interface TaskSchedulerTickResult {
	createdRunIds: string[];
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_CLAIM_LEASE_MS = 5 * 60_000;
const DEFAULT_STALE_AFTER_MS = 30 * 60_000;

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function deriveConcurrencyKey(task: ScheduledTaskRecord): string {
	const policy = task.policy as Partial<{ concurrencyKey: string }> | null;
	if (policy?.concurrencyKey) {
		return policy.concurrencyKey;
	}
	return `task:${task.type}:${task.scopeKind}:${stableStringify(task.scope)}`;
}

export class TaskScheduler {
	private timer: NodeJS.Timeout | null = null;
	private stopped = false;
	private readonly now: () => Date;
	private readonly intervalMs: number;
	private readonly claimLeaseMs: number;
	private readonly staleAfterMs: number;

	public constructor(private readonly options: TaskSchedulerOptions) {
		this.now = options.now ?? (() => new Date());
		this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.claimLeaseMs = options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS;
		this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
	}

	public start(): void {
		if (this.timer) {
			return;
		}
		this.stopped = false;
		this.timer = setInterval(() => {
			void this.tick().catch(() => undefined);
			void this.markStaleRuns().catch(() => undefined);
		}, this.intervalMs);
		this.timer.unref?.();
		void this.tick().catch(() => undefined);
	}

	public stop(): void {
		this.stopped = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	public async tick(input?: { now?: Date }): Promise<TaskSchedulerTickResult> {
		if (this.stopped) {
			return { createdRunIds: [] };
		}
		const now = input?.now ?? this.now();
		const nowIso = now.toISOString();
		const dueTasks = await this.options.scheduledTasks.listDue(nowIso);
		const createdRunIds: string[] = [];
		for (const task of dueTasks) {
			const freshTask = await this.options.scheduledTasks.get(task.id);
			if (
				!freshTask?.enabled ||
				!freshTask.nextRunAt ||
				freshTask.nextRunAt > nowIso
			) {
				continue;
			}
			const claimedTask = await this.options.scheduledTasks.claimDue(
				freshTask.id,
				{
					nowIso,
					workerId: this.options.workerId,
					claimExpiresAt: new Date(
						now.getTime() + this.claimLeaseMs,
					).toISOString(),
				},
			);
			if (!claimedTask) {
				continue;
			}
			if (claimedTask.scheduleKind === "condition") {
				const run = await this.evaluateClaimedConditionTask(claimedTask, now);
				if (run) {
					createdRunIds.push(run.id);
				}
				continue;
			}
			const run = await this.createDueRunFromScheduledTask(claimedTask, now);
			createdRunIds.push(run.id);
		}
		return { createdRunIds };
	}

	public async evaluateClaimedConditionTask(
		task: ScheduledTaskRecord,
		now: Date,
	): Promise<TaskRunRecord | null> {
		if (!this.options.conditionEvaluator) {
			await this.options.scheduledTasks.update(task.id, {
				claimWorkerId: null,
				claimExpiresAt: null,
				nextRunAt:
					calculateNextRunAt({
						scheduleKind: task.scheduleKind,
						schedulePreset: task.schedulePreset,
						cronExpression: task.cronExpression,
						trigger: task.trigger,
						now,
					})?.toISOString() ?? null,
				updatedAt: now.toISOString(),
			});
			return null;
		}
		const evaluation = await this.options.conditionEvaluator.evaluate(task, {
			now,
		});
		if (!evaluation.hit) {
			await this.appendConditionEvaluationEvent(task, evaluation, now);
			await this.options.scheduledTasks.update(task.id, {
				claimWorkerId: null,
				claimExpiresAt: null,
				nextRunAt:
					calculateNextRunAt({
						scheduleKind: task.scheduleKind,
						schedulePreset: task.schedulePreset,
						cronExpression: task.cronExpression,
						trigger: task.trigger,
						now,
					})?.toISOString() ?? null,
				updatedAt: now.toISOString(),
			});
			return null;
		}
		return this.createConditionRunFromScheduledTask(task, evaluation, now);
	}

	public async createDueRunFromScheduledTask(
		task: ScheduledTaskRecord,
		now: Date,
	) {
		validateScheduleDefinition({
			scheduleKind: task.scheduleKind,
			schedulePreset: task.schedulePreset,
			cronExpression: task.cronExpression,
			trigger: task.trigger,
		});
		const category =
			this.options.registry?.get(task.type)?.category ?? "maintenance";
		const concurrencyKey = deriveConcurrencyKey(task);
		const blockingRun =
			await this.options.taskRuns.findRunningByConcurrencyKey(concurrencyKey);
		const triggerSnapshot = { dueAt: now.toISOString() };
		const input = task.payload;
		const run = blockingRun
			? await this.options.taskRuns.recordLockConflict({
					scheduledTask: task,
					trigger: "schedule",
					triggerSnapshot,
					input,
					category,
					conflictWithRunId: blockingRun.id,
					conflictWithTaskName:
						blockingRun.scheduledTaskNameSnapshot ?? blockingRun.type,
					concurrencyKey,
				})
			: await this.options.taskRuns.createScheduledTaskRun({
					scheduledTask: task,
					trigger: "schedule",
					triggerSnapshot,
					input,
					category,
					concurrencyKey,
					createdAt: now.toISOString(),
					updatedAt: now.toISOString(),
				});
		if (blockingRun) {
			await this.options.eventLogs.append({
				taskRunId: run.id,
				eventType: "lock_conflict",
				level: "warn",
				message: "Task run blocked by concurrency lock.",
				data: {
					conflictWithRunId: blockingRun.id,
					concurrencyKey,
				},
				visibleToSiteAdmin: true,
				createdAt: now.toISOString(),
			});
			await this.options.failureNotifications?.planForFailedRun(run);
		}
		const nextRunAt =
			task.scheduleKind === "once"
				? null
				: (calculateNextRunAt({
						scheduleKind: task.scheduleKind,
						schedulePreset: task.schedulePreset,
						cronExpression: task.cronExpression,
						trigger: task.trigger,
						now,
					})?.toISOString() ?? null);
		await this.options.scheduledTasks.updateAfterRun(task.id, {
			lastRunAt: now.toISOString(),
			lastRunId: run.id,
			lastStatus: run.status,
			nextRunAt,
			enabled: task.scheduleKind === "once" ? false : undefined,
			disabledReason:
				task.scheduleKind === "once" ? "once_completed" : undefined,
			updatedAt: now.toISOString(),
		});
		return run;
	}

	public async createConditionRunFromScheduledTask(
		task: ScheduledTaskRecord,
		evaluation: ConditionEvaluationResult,
		now: Date,
	) {
		const concurrencyKey = deriveConcurrencyKey(task);
		const blockingRun =
			await this.options.taskRuns.findRunningByConcurrencyKey(concurrencyKey);
		const triggerSnapshot = {
			...evaluation.snapshot,
			status: evaluation.status,
		};
		const input = task.payload;
		const category =
			this.options.registry?.get(task.type)?.category ?? "maintenance";
		const run = blockingRun
			? await this.options.taskRuns.recordLockConflict({
					scheduledTask: task,
					trigger: "condition",
					triggerSnapshot,
					input,
					category,
					conflictWithRunId: blockingRun.id,
					conflictWithTaskName:
						blockingRun.scheduledTaskNameSnapshot ?? blockingRun.type,
					concurrencyKey,
				})
			: await this.options.taskRuns.createScheduledTaskRun({
					scheduledTask: task,
					trigger: "condition",
					triggerSnapshot,
					input,
					category,
					concurrencyKey,
					createdAt: now.toISOString(),
					updatedAt: now.toISOString(),
				});
		await this.options.eventLogs.append({
			taskRunId: run.id,
			eventType: blockingRun ? "condition_lock_conflict" : "condition_hit",
			level: blockingRun ? "warn" : "info",
			message: blockingRun
				? "Condition trigger hit but was blocked by concurrency lock."
				: "Condition trigger created a task run.",
			data: triggerSnapshot,
			visibleToSiteAdmin: true,
			createdAt: now.toISOString(),
		});
		if (blockingRun) {
			await this.options.failureNotifications?.planForFailedRun(run);
		}
		await this.options.scheduledTasks.updateAfterRun(task.id, {
			lastRunAt: now.toISOString(),
			lastRunId: run.id,
			lastStatus: run.status,
			nextRunAt:
				calculateNextRunAt({
					scheduleKind: task.scheduleKind,
					schedulePreset: task.schedulePreset,
					cronExpression: task.cronExpression,
					trigger: task.trigger,
					now,
				})?.toISOString() ?? null,
			updatedAt: now.toISOString(),
		});
		return run;
	}

	private async appendConditionEvaluationEvent(
		task: ScheduledTaskRecord,
		evaluation: ConditionEvaluationResult,
		now: Date,
	) {
		const syntheticRun = await this.options.taskRuns.createScheduledTaskRun({
			scheduledTask: task,
			trigger: "condition_evaluation",
			triggerSnapshot: evaluation.snapshot,
			input: task.payload,
			category:
				this.options.registry?.get(task.type)?.category ?? "maintenance",
			status: "skipped",
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		});
		await this.options.taskRuns.markSkipped(
			syntheticRun.id,
			`condition_${evaluation.status}`,
			evaluation.snapshot,
		);
		await this.options.eventLogs.append({
			taskRunId: syntheticRun.id,
			eventType: `condition_${evaluation.status}`,
			level:
				evaluation.status === "invalid_expression" ||
				evaluation.status === "invalid_metric"
					? "warn"
					: "info",
			message: evaluation.message,
			data: evaluation.snapshot,
			visibleToSiteAdmin: evaluation.status !== "invalid_expression",
			createdAt: now.toISOString(),
		});
	}

	public async markStaleRuns(input?: {
		now?: Date;
		staleAfterMs?: number;
	}): Promise<{ failedRunIds: string[] }> {
		const now = input?.now ?? this.now();
		const staleAfterMs = input?.staleAfterMs ?? this.staleAfterMs;
		const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();
		const staleRuns = await this.options.taskRuns.listStaleRunning(staleBefore);
		const failedRunIds: string[] = [];
		for (const run of staleRuns) {
			const failedRun = await this.options.taskRuns.markFailed(run.id, {
				code: "TASK_RUN_STALE",
				staleBefore,
			});
			await this.options.eventLogs.append({
				taskRunId: run.id,
				eventType: "stale_run_failed",
				level: "warn",
				message: "Running task exceeded its lease window.",
				data: { staleBefore },
				visibleToSiteAdmin: true,
				createdAt: now.toISOString(),
			});
			await this.options.failureNotifications?.planForFailedRun(failedRun);
			failedRunIds.push(run.id);
		}
		return { failedRunIds };
	}
}
