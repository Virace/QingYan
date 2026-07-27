import type { NotificationWorker } from "./notification-worker";

export interface NotificationRuntimeState {
	started: boolean;
	running: boolean;
	lastTickAt: string | null;
	lastError: string | null;
}

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_CLAIM_LIMIT = 10;

function errorMessage(error: unknown): string {
	return error instanceof Error
		? error.message
		: "Notification worker tick failed.";
}

export class NotificationRuntime {
	private timer: NodeJS.Timeout | null = null;
	private runningTick: Promise<number> | null = null;
	private stopped = true;
	private snapshot: NotificationRuntimeState = {
		started: false,
		running: false,
		lastTickAt: null,
		lastError: null,
	};

	public constructor(
		private readonly input: {
			worker: Pick<NotificationWorker, "runNextNotificationTask">;
			intervalMs?: number;
			claimLimit?: number;
			now?: () => Date;
			onError?: (error: unknown) => void;
		},
	) {}

	public start(): void {
		if (this.timer) {
			return;
		}
		this.stopped = false;
		this.snapshot = {
			...this.snapshot,
			started: true,
		};
		const intervalMs = this.input.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.timer = setInterval(() => {
			void this.tick();
		}, intervalMs);
		this.timer.unref?.();
	}

	public async stop(): Promise<void> {
		this.stopped = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		await this.runningTick?.catch(() => undefined);
		this.snapshot = {
			...this.snapshot,
			started: false,
			running: false,
		};
	}

	public state(): NotificationRuntimeState {
		return { ...this.snapshot };
	}

	public async tick(): Promise<number> {
		if (this.stopped) {
			return 0;
		}
		if (this.runningTick) {
			return this.runningTick;
		}
		const tickPromise = this.runTick();
		this.runningTick = tickPromise;
		try {
			return await tickPromise;
		} finally {
			if (this.runningTick === tickPromise) {
				this.runningTick = null;
			}
		}
	}

	private async runTick(): Promise<number> {
		const now = this.input.now?.() ?? new Date();
		this.snapshot = {
			...this.snapshot,
			running: true,
			lastTickAt: now.toISOString(),
		};
		try {
			const processed = await this.input.worker.runNextNotificationTask({
				limit: this.input.claimLimit ?? DEFAULT_CLAIM_LIMIT,
				now,
			});
			this.snapshot = {
				...this.snapshot,
				running: false,
				lastError: null,
			};
			return processed;
		} catch (error) {
			this.input.onError?.(error);
			this.snapshot = {
				...this.snapshot,
				running: false,
				lastError: errorMessage(error),
			};
			return 0;
		}
	}
}
