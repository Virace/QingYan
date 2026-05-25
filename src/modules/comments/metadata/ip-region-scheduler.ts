import type { AppDatabase } from "../../../db/client";
import type { SystemSettings } from "../../system-settings/definitions";
import { IpRegionUpdater } from "./ip-region-updater";

const MONTHLY_UPDATE_HOUR = 4;

export function nextMonthlyIpRegionUpdate(now = new Date()): Date {
	const candidate = new Date(now);
	candidate.setDate(1);
	candidate.setHours(MONTHLY_UPDATE_HOUR, 0, 0, 0);
	if (candidate.getTime() <= now.getTime()) {
		candidate.setMonth(candidate.getMonth() + 1);
	}

	return candidate;
}

export class IpRegionAutoUpdateScheduler {
	private timer: NodeJS.Timeout | null = null;
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
		if (!(await this.hasEnabledSettings())) {
			return;
		}

		this.schedule();
	}

	public stop(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private async hasEnabledSettings(): Promise<boolean> {
		const ipRegion = await this.loadIpRegionSettings();
		return ipRegion.enabled && ipRegion.autoUpdate.enabled;
	}

	private schedule(): void {
		this.stop();
		const delay = Math.max(
			nextMonthlyIpRegionUpdate().getTime() - Date.now(),
			1_000,
		);
		this.timer = setTimeout(() => {
			void this.runAndReschedule();
		}, delay);
		this.timer.unref?.();
	}

	private async runAndReschedule(): Promise<void> {
		try {
			await this.runNow();
		} finally {
			if (await this.hasEnabledSettings()) {
				this.schedule();
			}
		}
	}

	public async runNow(): Promise<void> {
		const ipRegion = await this.loadIpRegionSettings();
		if (!ipRegion.enabled || !ipRegion.autoUpdate.enabled) {
			return;
		}

		await this.updater.update({ ipVersion: "v4", config: ipRegion });
		await this.updater.update({ ipVersion: "v6", config: ipRegion });
	}
}
