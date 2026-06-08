export type ScheduleKind =
	| "manual_only"
	| "once"
	| "interval"
	| "daily"
	| "weekly"
	| "monthly"
	| "cron"
	| "condition";

export interface ScheduleCalculationInput {
	scheduleKind: string;
	schedulePreset?: string | null;
	cronExpression?: string | null;
	trigger?: unknown;
	now?: Date;
	minimumIntervalMinutes?: number;
}

const DEFAULT_MINIMUM_INTERVAL_MINUTES = 5;
const DEFAULT_CONDITION_EVALUATION_INTERVAL_SEC = 300;
const MINIMUM_CONDITION_EVALUATION_INTERVAL_SEC = 60;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function readPositiveNumber(
	value: unknown,
	fallback: number | null = null,
): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback;
}

function readTime(
	value: unknown,
	fallback: string,
): { hour: number; minute: number } {
	const source = typeof value === "string" ? value : fallback;
	const match = /^(\d{1,2}):(\d{2})$/.exec(source);
	if (!match) {
		throw new Error(`Invalid schedule time: ${source}`);
	}
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
		throw new Error(`Invalid schedule time: ${source}`);
	}
	return { hour, minute };
}

function addMinutes(date: Date, minutes: number): Date {
	return new Date(date.getTime() + minutes * MINUTE_MS);
}

function addSeconds(date: Date, seconds: number): Date {
	return new Date(date.getTime() + seconds * 1000);
}

function atUtcTime(base: Date, time: { hour: number; minute: number }): Date {
	const candidate = new Date(base);
	candidate.setUTCHours(time.hour, time.minute, 0, 0);
	return candidate;
}

function intervalMinutesForPreset(preset?: string | null): number | null {
	switch (preset) {
		case "hourly":
			return 60;
		case "every_2_hours":
			return 120;
		default:
			return null;
	}
}

function validateMinimumInterval(
	minutes: number,
	minimumIntervalMinutes = DEFAULT_MINIMUM_INTERVAL_MINUTES,
): void {
	if (minutes < minimumIntervalMinutes) {
		throw new Error(
			`Schedule interval is below the minimum interval of ${minimumIntervalMinutes} minutes.`,
		);
	}
}

function parseCronField(field: string, min: number, max: number): Set<number> {
	const values = new Set<number>();
	for (const part of field.split(",")) {
		const [rangePart, stepPart] = part.split("/");
		const step = stepPart ? Number(stepPart) : 1;
		if (!Number.isInteger(step) || step <= 0) {
			throw new Error(`Invalid cron step: ${part}`);
		}
		let start: number;
		let end: number;
		if (rangePart === "*") {
			start = min;
			end = max;
		} else if (rangePart?.includes("-")) {
			const [rawStart, rawEnd] = rangePart.split("-");
			start = Number(rawStart);
			end = Number(rawEnd);
		} else {
			start = Number(rangePart);
			end = start;
		}
		if (
			!Number.isInteger(start) ||
			!Number.isInteger(end) ||
			start < min ||
			end > max ||
			start > end
		) {
			throw new Error(`Invalid cron field: ${field}`);
		}
		for (let value = start; value <= end; value += step) {
			values.add(value);
		}
	}
	return values;
}

function parseFiveFieldCron(expression: string) {
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) {
		throw new Error("Cron expressions must use five-field format.");
	}
	return {
		minutes: parseCronField(fields[0] ?? "", 0, 59),
		hours: parseCronField(fields[1] ?? "", 0, 23),
		daysOfMonth: parseCronField(fields[2] ?? "", 1, 31),
		months: parseCronField(fields[3] ?? "", 1, 12),
		daysOfWeek: parseCronField(fields[4] ?? "", 0, 7),
	};
}

function nextCronRun(expression: string, now: Date): Date {
	const cron = parseFiveFieldCron(expression);
	const candidate = new Date(now.getTime() + MINUTE_MS);
	candidate.setUTCSeconds(0, 0);
	const maxAttempts = 366 * 24 * 60;
	for (let index = 0; index < maxAttempts; index += 1) {
		const dayOfWeek = candidate.getUTCDay();
		const matchesDayOfWeek =
			cron.daysOfWeek.has(dayOfWeek) ||
			(dayOfWeek === 0 && cron.daysOfWeek.has(7));
		if (
			cron.minutes.has(candidate.getUTCMinutes()) &&
			cron.hours.has(candidate.getUTCHours()) &&
			cron.daysOfMonth.has(candidate.getUTCDate()) &&
			cron.months.has(candidate.getUTCMonth() + 1) &&
			matchesDayOfWeek
		) {
			return candidate;
		}
		candidate.setTime(candidate.getTime() + MINUTE_MS);
	}
	throw new Error(`Unable to calculate next cron run: ${expression}`);
}

export function validateScheduleDefinition(
	input: ScheduleCalculationInput,
): void {
	const trigger = readRecord(input.trigger);
	const minimumIntervalMinutes =
		input.minimumIntervalMinutes ?? DEFAULT_MINIMUM_INTERVAL_MINUTES;
	switch (input.scheduleKind) {
		case "manual_only":
			return;
		case "once": {
			if (typeof trigger.runAt !== "string") {
				throw new Error("Once schedule requires trigger.runAt.");
			}
			if (Number.isNaN(new Date(trigger.runAt).getTime())) {
				throw new Error("Once schedule has an invalid trigger.runAt.");
			}
			return;
		}
		case "interval": {
			const minutes =
				intervalMinutesForPreset(input.schedulePreset) ??
				readPositiveNumber(trigger.everyMinutes);
			if (!minutes) {
				throw new Error("Interval schedule requires everyMinutes.");
			}
			validateMinimumInterval(minutes, minimumIntervalMinutes);
			return;
		}
		case "daily":
			readTime(trigger.time, "09:00");
			return;
		case "weekly": {
			const dayOfWeek = readPositiveNumber(trigger.dayOfWeek, 1);
			if (dayOfWeek === null || dayOfWeek < 0 || dayOfWeek > 6) {
				throw new Error("Weekly schedule dayOfWeek must be 0-6.");
			}
			readTime(trigger.time, "09:00");
			return;
		}
		case "monthly": {
			const dayOfMonth = readPositiveNumber(trigger.dayOfMonth, 1);
			if (dayOfMonth === null || dayOfMonth < 1 || dayOfMonth > 31) {
				throw new Error("Monthly schedule dayOfMonth must be 1-31.");
			}
			readTime(trigger.time, "09:00");
			return;
		}
		case "cron":
			if (!input.cronExpression) {
				throw new Error("Cron schedule requires cronExpression.");
			}
			parseFiveFieldCron(input.cronExpression);
			return;
		case "condition": {
			const condition = readRecord(trigger.condition ?? trigger);
			if (!condition.expression) {
				throw new Error(
					"Condition schedule requires trigger.condition.expression.",
				);
			}
			const evaluationIntervalSec = readPositiveNumber(
				condition.evaluationIntervalSec,
				DEFAULT_CONDITION_EVALUATION_INTERVAL_SEC,
			);
			if (
				evaluationIntervalSec === null ||
				evaluationIntervalSec < MINIMUM_CONDITION_EVALUATION_INTERVAL_SEC
			) {
				throw new Error(
					`Condition evaluation interval is below the minimum interval of ${MINIMUM_CONDITION_EVALUATION_INTERVAL_SEC} seconds.`,
				);
			}
			return;
		}
		default:
			throw new Error(`Unsupported schedule kind: ${input.scheduleKind}`);
	}
}

export function calculateNextRunAt(
	input: ScheduleCalculationInput,
): Date | null {
	validateScheduleDefinition(input);
	const now = input.now ?? new Date();
	const trigger = readRecord(input.trigger);
	switch (input.scheduleKind) {
		case "manual_only":
			return null;
		case "once": {
			const runAt = new Date(String(trigger.runAt));
			return runAt.getTime() > now.getTime() ? runAt : null;
		}
		case "interval": {
			const minutes =
				intervalMinutesForPreset(input.schedulePreset) ??
				readPositiveNumber(trigger.everyMinutes);
			if (!minutes) {
				throw new Error("Interval schedule requires everyMinutes.");
			}
			return addMinutes(now, minutes);
		}
		case "daily": {
			const time = readTime(trigger.time, "09:00");
			const candidate = atUtcTime(now, time);
			if (candidate.getTime() <= now.getTime()) {
				candidate.setTime(candidate.getTime() + DAY_MS);
			}
			return candidate;
		}
		case "weekly": {
			const dayOfWeek = readPositiveNumber(trigger.dayOfWeek, 1);
			const time = readTime(trigger.time, "09:00");
			const candidate = atUtcTime(now, time);
			const daysAhead = ((dayOfWeek ?? 1) - now.getUTCDay() + 7) % 7;
			candidate.setUTCDate(candidate.getUTCDate() + daysAhead);
			if (candidate.getTime() <= now.getTime()) {
				candidate.setUTCDate(candidate.getUTCDate() + 7);
			}
			return candidate;
		}
		case "monthly": {
			const dayOfMonth = Math.min(
				readPositiveNumber(trigger.dayOfMonth, 1) ?? 1,
				31,
			);
			const time = readTime(trigger.time, "09:00");
			const candidate = atUtcTime(now, time);
			candidate.setUTCDate(1);
			candidate.setUTCDate(dayOfMonth);
			if (
				candidate.getUTCDate() !== dayOfMonth ||
				candidate.getTime() <= now.getTime()
			) {
				candidate.setUTCMonth(candidate.getUTCMonth() + 1, 1);
				const maxDay = new Date(
					Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0),
				).getUTCDate();
				candidate.setUTCDate(Math.min(dayOfMonth, maxDay));
			}
			return candidate;
		}
		case "cron":
			return nextCronRun(input.cronExpression ?? "", now);
		case "condition": {
			const condition = readRecord(trigger.condition ?? trigger);
			const evaluationIntervalSec =
				readPositiveNumber(
					condition.evaluationIntervalSec,
					DEFAULT_CONDITION_EVALUATION_INTERVAL_SEC,
				) ?? DEFAULT_CONDITION_EVALUATION_INTERVAL_SEC;
			return addSeconds(now, evaluationIntervalSec);
		}
		default:
			throw new Error(`Unsupported schedule kind: ${input.scheduleKind}`);
	}
}
