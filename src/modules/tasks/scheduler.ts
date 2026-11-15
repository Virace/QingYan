import { canonicalJson } from "../../db/values";
import type {
	ConditionEvaluationResult,
	ConditionTriggerEvaluator,
} from "./condition-trigger-evaluator";
import {
	calculateNextRunAt,
	validateScheduleDefinition,
} from "./schedule-calculator";
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

export function deriveConcurrencyKey(task: ScheduledTaskRecord): string {
	const policy = task.policy as Partial<{ concurrencyKey: string }> | null;
	if (policy?.concurrencyKey) {
		return policy.concurrencyKey;
	}
	return `task:${task.type}:${task.scopeKind}:${canonicalJson(task.scope)}`;
}

export class TaskScheduler {
	private timer: NodeJS.Timeout | null = null;
	private stopped = false;
	private readonly pendingTicks = new Set<Promise<unknown>>();
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
			this.trackTick(this.tick());
			this.trackTick(this.markStaleRuns());
		}, this.intervalMs);
		this.timer.unref?.();
		this.trackTick(this.tick());
	}

	public async stop(): Promise<void> {
		this.stopped = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		await Promise.allSettled([...this.pendingTicks]);
	}

	private trackTick<T>(promise: Promise<T>): void {
		this.pendingTicks.add(promise);
		void promise
			.catch(() => undefined)
			.finally(() => {
				this.pendingTicks.delete(promise);
			});
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
			if (run) createdRunIds.push(run.id);
		}
		return { createdRunIds };
	}

	public async evaluateClaimedConditionTask(
		task: ScheduledTaskRecord,
		now: Date,
	): Promise<TaskRunRecord | null> {
		if (!this.options.conditionEvaluator) {
			await this.options.scheduledTasks.releaseClaim(task, {
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
		const run = await this.options.taskRuns.createScheduledTaskRunAndAdvance(
			{
				scheduledTask: task,
				trigger: "schedule",
				triggerSnapshot: { dueAt: now.toISOString() },
				input: task.payload,
				category:
					this.options.registry?.get(task.type)?.category ?? "maintenance",
				concurrencyKey: deriveConcurrencyKey(task),
				createdAt: now.toISOString(),
				updatedAt: now.toISOString(),
			},
			{
				nextRunAt,
				enabled: task.scheduleKind === "once" ? false : undefined,
				disabledReason:
					task.scheduleKind === "once" ? "once_completed" : undefined,
			},
		);
		if (!run) return null;
		if (run.lockConflictWithRunId)
			await this.options.failureNotifications?.planForFailedRun(run);
		await this.options.taskRuns.finalizeScheduledTaskRun(run.id);
		return run;
	}

	public async createConditionRunFromScheduledTask(
		task: ScheduledTaskRecord,
		evaluation: ConditionEvaluationResult,
		now: Date,
	) {
		const triggerSnapshot = {
			...evaluation.snapshot,
			status: evaluation.status,
		};
		const run = await this.options.taskRuns.createScheduledTaskRunAndAdvance(
			{
				scheduledTask: task,
				trigger: "condition",
				triggerSnapshot,
				input: task.payload,
				category:
					this.options.registry?.get(task.type)?.category ?? "maintenance",
				concurrencyKey: deriveConcurrencyKey(task),
				createdAt: now.toISOString(),
				updatedAt: now.toISOString(),
			},
			{
				nextRunAt:
					calculateNextRunAt({
						scheduleKind: task.scheduleKind,
						schedulePreset: task.schedulePreset,
						cronExpression: task.cronExpression,
						trigger: task.trigger,
						now,
					})?.toISOString() ?? null,
			},
		);
		if (!run) return null;
		const blocked = Boolean(run.lockConflictWithRunId);
		await this.options.eventLogs.append({
			taskRunId: run.id,
			eventType: blocked ? "condition_lock_conflict" : "condition_hit",
			level: blocked ? "warn" : "info",
			message: blocked
				? "条件命中，但任务正在执行。"
				: "条件命中，已创建任务运行。",
			data: triggerSnapshot,
			visibleToSiteAdmin: true,
			createdAt: now.toISOString(),
		});
		if (blocked) await this.options.failureNotifications?.planForFailedRun(run);
		await this.options.taskRuns.finalizeScheduledTaskRun(run.id);
		return run;
	}

	private async appendConditionEvaluationEvent(
		task: ScheduledTaskRecord,
		evaluation: ConditionEvaluationResult,
		now: Date,
	) {
		const syntheticRun =
			await this.options.taskRuns.createScheduledTaskRunAndAdvance(
				{
					scheduledTask: task,
					trigger: "condition_evaluation",
					triggerSnapshot: evaluation.snapshot,
					input: task.payload,
					category:
						this.options.registry?.get(task.type)?.category ?? "maintenance",
					status: "skipped",
					createdAt: now.toISOString(),
					updatedAt: now.toISOString(),
				},
				{
					nextRunAt:
						calculateNextRunAt({
							scheduleKind: task.scheduleKind,
							schedulePreset: task.schedulePreset,
							cronExpression: task.cronExpression,
							trigger: task.trigger,
							now,
						})?.toISOString() ?? null,
				},
			);
		if (!syntheticRun) return;
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
		await this.options.taskRuns.finalizeScheduledTaskRun(syntheticRun.id);
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
			const failedRun = await this.options.taskRuns.expireStale(
				run,
				staleBefore,
				{
					code: "TASK_RUN_STALE",
					staleBefore,
				},
			);
			if (!failedRun) continue;
			await this.options.failureNotifications?.planForFailedRun(failedRun);
			await this.options.taskRuns.finalizeScheduledTaskRun(failedRun.id);
			failedRunIds.push(run.id);
		}
		return { failedRunIds };
	}
}
