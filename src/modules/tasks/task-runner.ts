import type { TaskEventLogRepository } from "./task-event-log-repository";
import type { TaskRunRepository } from "./task-run-repository";
import type { ScheduledTaskRepository } from "./scheduled-task-repository";
import type {
	TaskRunnerContext,
	TaskRunnerServices,
} from "./task-runner-context";
import { createTaskLogWriter } from "./task-log-writer";
import type { TaskTypeRegistry } from "./task-type-registry";
import type { TaskRunRecord } from "./types";

export interface TaskRunnerOptions {
	registry: TaskTypeRegistry;
	taskRuns: TaskRunRepository;
	scheduledTasks?: ScheduledTaskRepository;
	eventLogs: TaskEventLogRepository;
	failureNotifications?: {
		planForFailedRun(run: TaskRunRecord): Promise<unknown>;
	};
	services?: TaskRunnerServices;
	workerId: string;
	now?: () => Date;
}

export class TaskRunCancelledError extends Error {
	public constructor(message = "Task run cancelled.") {
		super(message);
		this.name = "TaskRunCancelledError";
	}
}

export class TaskRunSuppressedError extends Error {
	public constructor(message = "Task run suppressed by policy.") {
		super(message);
		this.name = "TaskRunSuppressedError";
	}
}

export class TaskRunner {
	private readonly now: () => Date;

	public constructor(private readonly options: TaskRunnerOptions) {
		this.now = options.now ?? (() => new Date());
	}

	public async run(runId: string): Promise<void> {
		const run = await this.options.taskRuns.markRunning(runId, {
			workerId: this.options.workerId,
			heartbeatAt: this.now().toISOString(),
		});
		await this.runClaimed(run);
	}

	public async runClaimed(run: TaskRunRecord): Promise<void> {
		try {
			const definition = this.options.registry.getRequired(run.type);
			const payload = definition.payloadSchema.parse(run.input ?? run.payload);
			const scheduledTask = run.scheduledTaskId
				? await this.options.scheduledTasks?.get(run.scheduledTaskId)
				: null;
			const context: TaskRunnerContext = {
				runId: run.id,
				scheduledTaskId: run.scheduledTaskId,
				scheduledTaskSystemKey: scheduledTask?.systemKey ?? null,
				actor: { type: "system" },
				services: this.options.services ?? {},
				log: createTaskLogWriter({
					taskRunId: run.id,
					eventLogs: this.options.eventLogs,
				}),
				now: this.now,
				writeEvent: async (event) => {
					await this.options.eventLogs.append({
						taskRunId: run.id,
						eventType: event.eventType,
						level: event.level ?? "info",
						message: event.message ?? event.eventType,
						data: event.data,
						visibleToSiteAdmin: event.visibleToSiteAdmin ?? false,
					});
				},
				updateProgress: async (progress) => {
					await this.options.taskRuns.updateProgress(run.id, progress);
				},
				writeAudit: () => undefined,
			};
			const precondition = definition.precondition
				? await definition.precondition(payload, context)
				: "ok";
			if (precondition === "blocked") {
				await this.options.taskRuns.markBlocked(run.id, "precondition_blocked");
				return;
			}
			if (precondition === "skipped") {
				await this.options.taskRuns.markSkipped(run.id, "precondition_skipped");
				return;
			}
			const result = await definition.run(payload, context);
			await this.options.taskRuns.markSucceeded(run.id, result);
		} catch (error) {
			if (error instanceof TaskRunCancelledError) {
				await this.options.taskRuns.cancel(run.id, {
					code: "TASK_RUN_CANCELLED",
					message: error.message,
				});
				return;
			}
			if (error instanceof TaskRunSuppressedError) {
				await this.options.taskRuns.markSuppressed(run.id, {
					code: "TASK_RUN_SUPPRESSED",
					message: error.message,
				});
				return;
			}
			const failedRun = await this.options.taskRuns.markFailed(run.id, {
				code: "TASK_RUN_FAILED",
				message: error instanceof Error ? error.message : String(error),
			});
			await this.options.failureNotifications?.planForFailedRun(failedRun);
		}
	}
}
