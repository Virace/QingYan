import { describe, expect, it, vi } from "vitest";

import type { AppDatabase } from "../../src/db/client";
import { defaultSystemSettings } from "../../src/modules/system-settings/definitions";

import {
	MAX_IP_REGION_UPDATE_DELAY_MS,
	IpRegionAutoUpdateScheduler,
	nextMonthlyIpRegionUpdate,
	nextMonthlyIpRegionUpdateDelay,
} from "../../src/modules/comments/metadata/ip-region-scheduler";

describe("nextMonthlyIpRegionUpdate", () => {
	it("uses this month first day 04:00 when it is still in the future", () => {
		expect(
			nextMonthlyIpRegionUpdate(new Date("2026-05-01T01:00:00+08:00"))
				.toISOString()
				.slice(0, 16),
		).toBe("2026-04-30T20:00");
	});

	it("rolls to next month after the monthly update time has passed", () => {
		expect(
			nextMonthlyIpRegionUpdate(new Date("2026-05-02T01:00:00+08:00"))
				.toISOString()
				.slice(0, 16),
		).toBe("2026-05-31T20:00");
	});

	it("caps long monthly delays to the maximum Node timeout", () => {
		expect(
			nextMonthlyIpRegionUpdateDelay(new Date("2026-05-02T01:00:00+08:00")),
		).toBe(MAX_IP_REGION_UPDATE_DELAY_MS);
	});

	it("keeps near monthly delays unchanged", () => {
		const now = new Date("2026-05-31T19:59:00.000Z");
		expect(nextMonthlyIpRegionUpdateDelay(now)).toBe(60_000);
	});
});

describe("IpRegionAutoUpdateScheduler", () => {
	it("waits for an in-flight update and does not reschedule after stop", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 10, 1, 3, 59, 59));
		let releaseUpdate!: () => void;
		let reportStarted!: () => void;
		const updateReleased = new Promise<void>((resolve) => {
			releaseUpdate = resolve;
		});
		const updateStarted = new Promise<void>((resolve) => {
			reportStarted = resolve;
		});
		const versions: string[] = [];
		const scheduler = new IpRegionAutoUpdateScheduler(
			{} as AppDatabase,
			async () => ({
				...defaultSystemSettings.ipRegion,
				enabled: true,
				autoUpdate: {
					...defaultSystemSettings.ipRegion.autoUpdate,
					enabled: true,
				},
			}),
			{
				updater: {
					async update(input) {
						versions.push(input.ipVersion);
						reportStarted();
						await updateReleased;
						return {
							status: "failed",
							refreshedComments: 0,
							errorMessage: "all_sources_failed",
						};
					},
				},
			},
		);
		try {
			await scheduler.start();
			await vi.advanceTimersByTimeAsync(1000);
			await updateStarted;
			let stopped = false;
			const stopping = scheduler.stop().then(() => {
				stopped = true;
			});
			await Promise.resolve();
			expect(stopped).toBe(false);
			releaseUpdate();
			await stopping;
			expect(stopped).toBe(true);
			expect(versions).toEqual(["v4"]);
			expect(vi.getTimerCount()).toBe(0);
			await vi.advanceTimersByTimeAsync(32 * 24 * 60 * 60 * 1000);
			expect(versions).toEqual(["v4"]);
		} finally {
			releaseUpdate();
			await scheduler.stop();
			vi.useRealTimers();
		}
	});
});
