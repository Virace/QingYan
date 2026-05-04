import type { AppConfig } from "../../../config/types";
import type { AppDatabase } from "../../../db/client";
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
	private readonly updater: IpRegionUpdater;

	public constructor(
		db: AppDatabase,
		private readonly config: AppConfig,
	) {
		this.updater = new IpRegionUpdater(db);
	}

	public start(): void {
		if (!this.hasEnabledSites()) {
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

	private hasEnabledSites(): boolean {
		return this.config.sites.some(
			(site) =>
				site.defaults.comments.metadata.ipRegion.enabled &&
				site.defaults.comments.metadata.ipRegion.autoUpdate.enabled,
		);
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
			for (const site of this.config.sites) {
				const ipRegion = site.defaults.comments.metadata.ipRegion;
				if (!ipRegion.enabled || !ipRegion.autoUpdate.enabled) {
					continue;
				}

				await this.updater.update({ ipVersion: "v4", config: ipRegion });
				await this.updater.update({ ipVersion: "v6", config: ipRegion });
			}
		} finally {
			if (this.hasEnabledSites()) {
				this.schedule();
			}
		}
	}
}
