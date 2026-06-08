import type { ScheduledTaskRecord } from "./scheduled-task-repository";
import type { TaskMetricRollupRepository } from "./task-metric-rollup-repository";

export type ConditionComparator = ">" | ">=" | "<" | "<=" | "==" | "!=";

export interface MetricConditionExpression {
	op: "metric";
	metricKey: string;
	comparator: ConditionComparator;
	threshold: number;
	windowSec: number;
	bucketSizeSec?: number;
	dimensions?: Record<string, unknown>;
}

export interface AndConditionExpression {
	op: "and";
	expressions: ConditionExpression[];
}

export interface OrConditionExpression {
	op: "or";
	expressions: ConditionExpression[];
}

export interface NotConditionExpression {
	op: "not";
	expression: ConditionExpression;
}

export type ConditionExpression =
	| MetricConditionExpression
	| AndConditionExpression
	| OrConditionExpression
	| NotConditionExpression;

export type ConditionEvaluationStatus =
	| "hit"
	| "miss"
	| "cooldown"
	| "min_interval"
	| "invalid_metric"
	| "invalid_expression";

export interface ConditionEvaluationResult {
	status: ConditionEvaluationStatus;
	hit: boolean;
	message: string;
	snapshot: {
		evaluatedAt: string;
		expression?: unknown;
		values?: Array<{
			metricKey: string;
			value: number;
			sampleCount: number;
			windowSec: number;
			bucketSizeSec: number;
			comparator: ConditionComparator;
			threshold: number;
			hit: boolean;
		}>;
		reason?: string;
	};
}

export interface ConditionTriggerConfig {
	enabled?: boolean;
	expression?: unknown;
	cooldownSec?: number;
	minIntervalSec?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function readConditionConfig(trigger: unknown): ConditionTriggerConfig | null {
	const triggerRecord = asRecord(trigger);
	const condition = asRecord(triggerRecord.condition);
	if (condition.expression) {
		return {
			enabled: condition.enabled !== false,
			expression: condition.expression,
			cooldownSec:
				typeof condition.cooldownSec === "number"
					? condition.cooldownSec
					: undefined,
			minIntervalSec:
				typeof condition.minIntervalSec === "number"
					? condition.minIntervalSec
					: undefined,
		};
	}
	if (triggerRecord.expression) {
		return {
			enabled: triggerRecord.enabled !== false,
			expression: triggerRecord.expression,
			cooldownSec:
				typeof triggerRecord.cooldownSec === "number"
					? triggerRecord.cooldownSec
					: undefined,
			minIntervalSec:
				typeof triggerRecord.minIntervalSec === "number"
					? triggerRecord.minIntervalSec
					: undefined,
		};
	}
	return null;
}

function parseExpression(value: unknown): ConditionExpression | null {
	const record = asRecord(value);
	if (record.op === "metric") {
		if (
			typeof record.metricKey !== "string" ||
			record.metricKey.length === 0 ||
			!isComparator(record.comparator) ||
			typeof record.threshold !== "number" ||
			!Number.isFinite(record.threshold) ||
			typeof record.windowSec !== "number" ||
			!Number.isFinite(record.windowSec) ||
			record.windowSec <= 0
		) {
			return null;
		}
		return {
			op: "metric",
			metricKey: record.metricKey,
			comparator: record.comparator,
			threshold: record.threshold,
			windowSec: record.windowSec,
			bucketSizeSec:
				typeof record.bucketSizeSec === "number" &&
				Number.isFinite(record.bucketSizeSec) &&
				record.bucketSizeSec > 0
					? record.bucketSizeSec
					: undefined,
			dimensions:
				record.dimensions && typeof record.dimensions === "object"
					? (record.dimensions as Record<string, unknown>)
					: undefined,
		};
	}
	if (record.op === "and" || record.op === "or") {
		if (!Array.isArray(record.expressions) || record.expressions.length === 0) {
			return null;
		}
		const expressions = record.expressions.map(parseExpression);
		if (expressions.some((expression) => expression === null)) {
			return null;
		}
		return {
			op: record.op,
			expressions: expressions as ConditionExpression[],
		};
	}
	if (record.op === "not") {
		const expression = parseExpression(record.expression);
		return expression ? { op: "not", expression } : null;
	}
	return null;
}

function isComparator(value: unknown): value is ConditionComparator {
	return [">", ">=", "<", "<=", "==", "!="].includes(String(value));
}

function compare(
	value: number,
	comparator: ConditionComparator,
	threshold: number,
): boolean {
	switch (comparator) {
		case ">":
			return value > threshold;
		case ">=":
			return value >= threshold;
		case "<":
			return value < threshold;
		case "<=":
			return value <= threshold;
		case "==":
			return value === threshold;
		case "!=":
			return value !== threshold;
	}
}

function secondsSince(iso: string | null, now: Date): number | null {
	if (!iso) {
		return null;
	}
	const time = new Date(iso).getTime();
	return Number.isNaN(time) ? null : Math.floor((now.getTime() - time) / 1000);
}

export class ConditionTriggerEvaluator {
	public constructor(
		private readonly metricRollups: TaskMetricRollupRepository,
		private readonly allowedMetricKeys: Set<string> = new Set([
			"request.completed",
			"request.failed",
			"request.rate_limited",
			"request.blocked.blacklist",
			"public.write",
			"security.blacklist.hit",
			"security.rate_limited",
		]),
	) {}

	public isConditionTask(task: ScheduledTaskRecord): boolean {
		return Boolean(readConditionConfig(task.trigger)?.enabled);
	}

	public async evaluate(
		task: ScheduledTaskRecord,
		input?: { now?: Date },
	): Promise<ConditionEvaluationResult> {
		const now = input?.now ?? new Date();
		const evaluatedAt = now.toISOString();
		const config = readConditionConfig(task.trigger);
		if (!config?.enabled) {
			return this.invalid(
				"condition_not_configured",
				evaluatedAt,
				task.trigger,
			);
		}
		const elapsed = secondsSince(task.lastRunAt, now);
		if (
			typeof config.cooldownSec === "number" &&
			elapsed !== null &&
			elapsed < config.cooldownSec
		) {
			return {
				status: "cooldown",
				hit: false,
				message: "Condition trigger is inside cooldown window.",
				snapshot: {
					evaluatedAt,
					expression: config.expression,
					reason: "cooldown",
				},
			};
		}
		if (
			typeof config.minIntervalSec === "number" &&
			elapsed !== null &&
			elapsed < config.minIntervalSec
		) {
			return {
				status: "min_interval",
				hit: false,
				message: "Condition trigger is inside minimum interval window.",
				snapshot: {
					evaluatedAt,
					expression: config.expression,
					reason: "min_interval",
				},
			};
		}
		const expression = parseExpression(config.expression);
		if (!expression) {
			return this.invalid("invalid_expression", evaluatedAt, config.expression);
		}
		const values: ConditionEvaluationResult["snapshot"]["values"] = [];
		const result = await this.evaluateExpression(task, expression, now, values);
		if (result === "invalid_metric") {
			return {
				status: "invalid_metric",
				hit: false,
				message: "Condition expression references an unknown metric.",
				snapshot: {
					evaluatedAt,
					expression: config.expression,
					values,
					reason: "invalid_metric",
				},
			};
		}
		return {
			status: result ? "hit" : "miss",
			hit: result,
			message: result
				? "Condition trigger matched rollup metrics."
				: "Condition trigger did not match rollup metrics.",
			snapshot: {
				evaluatedAt,
				expression: config.expression,
				values,
			},
		};
	}

	private invalid(
		reason: string,
		evaluatedAt: string,
		expression: unknown,
	): ConditionEvaluationResult {
		return {
			status: "invalid_expression",
			hit: false,
			message: "Condition trigger expression is invalid.",
			snapshot: { evaluatedAt, expression, reason },
		};
	}

	private async evaluateExpression(
		task: ScheduledTaskRecord,
		expression: ConditionExpression,
		now: Date,
		values: NonNullable<ConditionEvaluationResult["snapshot"]["values"]>,
	): Promise<boolean | "invalid_metric"> {
		if (expression.op === "metric") {
			if (!this.allowedMetricKeys.has(expression.metricKey)) {
				return "invalid_metric";
			}
			const rollup = await this.metricRollups.sumWindow({
				siteId: task.siteId,
				siteKey: this.siteKeyForTask(task),
				metricKey: expression.metricKey,
				windowSec: expression.windowSec,
				bucketSizeSec: expression.bucketSizeSec,
				dimensions: expression.dimensions,
				now,
			});
			const hit = compare(
				rollup.value,
				expression.comparator,
				expression.threshold,
			);
			values.push({
				metricKey: expression.metricKey,
				value: rollup.value,
				sampleCount: rollup.sampleCount,
				windowSec: expression.windowSec,
				bucketSizeSec: rollup.bucketSizeSec,
				comparator: expression.comparator,
				threshold: expression.threshold,
				hit,
			});
			return hit;
		}
		if (expression.op === "and") {
			for (const child of expression.expressions) {
				const result = await this.evaluateExpression(task, child, now, values);
				if (result === "invalid_metric") {
					return result;
				}
				if (!result) {
					return false;
				}
			}
			return true;
		}
		if (expression.op === "or") {
			let sawHit = false;
			for (const child of expression.expressions) {
				const result = await this.evaluateExpression(task, child, now, values);
				if (result === "invalid_metric") {
					return result;
				}
				sawHit = sawHit || result;
			}
			return sawHit;
		}
		const result = await this.evaluateExpression(
			task,
			expression.expression,
			now,
			values,
		);
		return result === "invalid_metric" ? result : !result;
	}

	private siteKeyForTask(task: ScheduledTaskRecord): string | null {
		const scope = asRecord(task.scope);
		const payload = asRecord(task.payload);
		if (typeof scope.siteKey === "string") {
			return scope.siteKey;
		}
		if (typeof payload.siteKey === "string") {
			return payload.siteKey;
		}
		return null;
	}
}
