import { describe, expect, it } from "vitest";

import {
	MAX_IP_REGION_UPDATE_DELAY_MS,
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
