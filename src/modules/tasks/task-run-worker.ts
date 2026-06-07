import type { TaskRunRepository } from "./task-run-repository";
import type { TaskRunner } from "./task-runner";

export interface TaskRunWorkerOptions {
	taskRuns: TaskRunRepository;
	runner: TaskRunner;
	workerId: string;
	intervalMs?: number;
	claimLimit?: number;
	now?: () => Date;
}

export interface TaskRunWorkerTickResult {
	claimedRunIds: string[];
}

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_CLAIM_LIMIT = 5;

export class TaskRunWorker {
	private timer: NodeJS.Timeout | null = null;
	private stopped = false;
	private running = false;
	private runningTick: Promise<TaskRunWorkerTickResult> | null = null;
	private readonly intervalMs: number;
	private readonly claimLimit: number;
	private readonly now: () => Date;

	public constructor(private readonly options: TaskRunWorkerOptions) {
		this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.claimLimit = options.claimLimit ?? DEFAULT_CLAIM_LIMIT;
		this.now = options.now ?? (() => new Date());
	}

	public start(): void {
		if (this.timer) {
			return;
		}
		this.stopped = false;
		this.timer = setInterval(() => {
			void this.tick().catch(() => undefined);
		}, this.intervalMs);
		this.timer.unref?.();
		void this.tick().catch(() => undefined);
	}

	public async stop(): Promise<void> {
		this.stopped = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		await this.runningTick?.catch(() => undefined);
	}

	public async tick(): Promise<TaskRunWorkerTickResult> {
		if (this.stopped || this.running) {
			return { claimedRunIds: [] };
		}
		this.running = true;
		const tickPromise = this.runTick();
		this.runningTick = tickPromise;
		try {
			return await tickPromise;
		} finally {
			if (this.runningTick === tickPromise) {
				this.runningTick = null;
			}
			this.running = false;
		}
	}

	private async runTick(): Promise<TaskRunWorkerTickResult> {
		const runs = await this.options.taskRuns.claimRunnable({
			workerId: this.options.workerId,
			nowIso: this.now().toISOString(),
			limit: this.claimLimit,
		});
		for (const run of runs) {
			await this.options.runner.runClaimed(run);
		}
		return { claimedRunIds: runs.map((run) => run.id) };
	}
}
