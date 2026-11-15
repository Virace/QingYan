import type { AppDatabase } from "../../../db/client";
import type { SystemSettings } from "../../system-settings/definitions";
import { IpRegionUpdater } from "./ip-region-updater";

const MONTHLY_UPDATE_HOUR = 4;
export const MAX_IP_REGION_UPDATE_DELAY_MS = 2_147_483_647;

export function nextMonthlyIpRegionUpdate(now = new Date()): Date {
	const candidate = new Date(now);
	candidate.setDate(1);
	candidate.setHours(MONTHLY_UPDATE_HOUR, 0, 0, 0);
	if (candidate.getTime() <= now.getTime()) {
		candidate.setMonth(candidate.getMonth() + 1);
	}

	return candidate;
}

export function nextMonthlyIpRegionUpdateDelay(now = new Date()): number {
	return Math.min(
		Math.max(nextMonthlyIpRegionUpdate(now).getTime() - now.getTime(), 1_000),
		MAX_IP_REGION_UPDATE_DELAY_MS,
	);
}

export class IpRegionAutoUpdateScheduler {
	private timer: NodeJS.Timeout | null = null;
	private stopped = false;
	private runningUpdate: Promise<void> | null = null;
	private runningTick: Promise<void> | null = null;
	private readonly updater: Pick<IpRegionUpdater, "update">;

	public constructor(
		db: AppDatabase,
		private readonly loadIpRegionSettings: () => Promise<
			SystemSettings["ipRegion"]
		>,
		options: { updater?: Pick<IpRegionUpdater, "update"> } = {},
	) {
		this.updater = options.updater ?? new IpRegionUpdater(db);
	}

	public async start(): Promise<void> {
		this.stopped = false;
		if (!(await this.hasEnabledSettings()) || this.stopped) {
			return;
		}

		this.schedule();
	}

	public async stop(): Promise<void> {
		this.stopped = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		await Promise.all([
			this.runningTick?.catch(() => undefined),
			this.runningUpdate?.catch(() => undefined),
		]);
	}

	private async hasEnabledSettings(): Promise<boolean> {
		const ipRegion = await this.loadIpRegionSettings();
		return ipRegion.enabled && ipRegion.autoUpdate.enabled;
	}

	private schedule(): void {
		if (this.stopped) return;
		if (this.timer) clearTimeout(this.timer);
		const delay = nextMonthlyIpRegionUpdateDelay();
		this.timer = setTimeout(() => {
			this.timer = null;
			const tick = this.runAndReschedule().finally(() => {
				if (this.runningTick === tick) this.runningTick = null;
			});
			this.runningTick = tick;
			void tick.catch(() => undefined);
		}, delay);
		this.timer.unref?.();
	}

	private async runAndReschedule(): Promise<void> {
		try {
			await this.runNow();
		} finally {
			if (!this.stopped && (await this.hasEnabledSettings())) {
				this.schedule();
			}
		}
	}

	public async runNow(): Promise<void> {
		if (this.stopped) return;
		if (this.runningUpdate) return this.runningUpdate;
		const update = this.runUpdate();
		this.runningUpdate = update;
		try {
			await update;
		} finally {
			if (this.runningUpdate === update) this.runningUpdate = null;
		}
	}

	private async runUpdate(): Promise<void> {
		const ipRegion = await this.loadIpRegionSettings();
		if (this.stopped || !ipRegion.enabled || !ipRegion.autoUpdate.enabled) {
			return;
		}

		await this.updater.update({ ipVersion: "v4", config: ipRegion });
		if (this.stopped) return;
		await this.updater.update({ ipVersion: "v6", config: ipRegion });
	}
}
