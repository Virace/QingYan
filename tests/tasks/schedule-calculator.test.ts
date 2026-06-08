import { describe, expect, it } from "vitest";

import {
	calculateNextRunAt,
	validateScheduleDefinition,
} from "../../src/modules/tasks/schedule-calculator";

const now = new Date("2026-06-04T10:00:00.000Z");

describe("schedule calculator", () => {
	it("does not schedule manual-only tasks", () => {
		expect(
			calculateNextRunAt({
				scheduleKind: "manual_only",
				now,
			}),
		).toBeNull();
	});

	it("supports once, interval, daily, weekly, monthly, and preset schedules", () => {
		expect(
			calculateNextRunAt({
				scheduleKind: "once",
				now,
				trigger: { runAt: "2026-06-04T12:00:00.000Z" },
			})?.toISOString(),
		).toBe("2026-06-04T12:00:00.000Z");
		expect(
			calculateNextRunAt({
				scheduleKind: "interval",
				now,
				trigger: { everyMinutes: 30 },
			})?.toISOString(),
		).toBe("2026-06-04T10:30:00.000Z");
		expect(
			calculateNextRunAt({
				scheduleKind: "daily",
				now,
				trigger: { time: "08:15" },
			})?.toISOString(),
		).toBe("2026-06-05T08:15:00.000Z");
		expect(
			calculateNextRunAt({
				scheduleKind: "weekly",
				now,
				trigger: { dayOfWeek: 5, time: "09:00" },
			})?.toISOString(),
		).toBe("2026-06-05T09:00:00.000Z");
		expect(
			calculateNextRunAt({
				scheduleKind: "monthly",
				now,
				trigger: { dayOfMonth: 1, time: "04:00" },
			})?.toISOString(),
		).toBe("2026-07-01T04:00:00.000Z");
		expect(
			calculateNextRunAt({
				scheduleKind: "interval",
				schedulePreset: "every_2_hours",
				now,
			})?.toISOString(),
		).toBe("2026-06-04T12:00:00.000Z");
	});

	it("accepts five-field cron and rejects seconds-level cron", () => {
		expect(
			calculateNextRunAt({
				scheduleKind: "cron",
				cronExpression: "15 11 * * *",
				now,
			})?.toISOString(),
		).toBe("2026-06-04T11:15:00.000Z");

		expect(() =>
			validateScheduleDefinition({
				scheduleKind: "cron",
				cronExpression: "0 15 11 * * *",
			}),
		).toThrow(/five-field/i);
	});

	it("enforces the minimum interval", () => {
		expect(() =>
			validateScheduleDefinition({
				scheduleKind: "interval",
				trigger: { everyMinutes: 2 },
				minimumIntervalMinutes: 5,
			}),
		).toThrow(/minimum interval/i);
	});
});
