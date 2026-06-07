import { randomUUID } from "node:crypto";

import { and, count, eq, gte, lte, sql } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { taskMetricRollups } from "../../db/schema";
import { stringifyJson } from "./types";

const DEFAULT_BUCKET_SIZE_SEC = 60;
const DEFAULT_MAX_DIMENSIONS_PER_BUCKET = 100;
const GLOBAL_SITE_KEY = "__global__";

function nowIso(): string {
	return new Date().toISOString();
}

function createRollupId(): string {
	return `task_metric_${randomUUID().replaceAll("-", "")}`;
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function normalizeDimensions(value?: Record<string, unknown>): string {
	if (!value || Object.keys(value).length === 0) {
		return "{}";
	}
	return stableStringify(value);
}

function bucketStartIso(at: Date, bucketSizeSec: number): string {
	const bucketMs = bucketSizeSec * 1000;
	return new Date(Math.floor(at.getTime() / bucketMs) * bucketMs).toISOString();
}

export interface TaskMetricIncrementInput {
	siteId?: number | null;
	siteKey?: string | null;
	metricKey: string;
	value?: number;
	sampleCount?: number;
	bucketSizeSec?: number;
	dimensions?: Record<string, unknown>;
	at?: Date;
}

export interface TaskMetricWindowInput {
	siteId?: number | null;
	siteKey?: string | null;
	metricKey: string;
	windowSec: number;
	bucketSizeSec?: number;
	dimensions?: Record<string, unknown>;
	now?: Date;
}

export class TaskMetricRollupRepository {
	private readonly maxDimensionsPerBucket: number;

	public constructor(
		private readonly db: AppDatabase,
		options?: { maxDimensionsPerBucket?: number },
	) {
		this.maxDimensionsPerBucket =
			options?.maxDimensionsPerBucket ?? DEFAULT_MAX_DIMENSIONS_PER_BUCKET;
	}

	public async increment(input: TaskMetricIncrementInput) {
		const bucketSizeSec = input.bucketSizeSec ?? DEFAULT_BUCKET_SIZE_SEC;
		const at = input.at ?? new Date();
		const siteKey = input.siteKey ?? GLOBAL_SITE_KEY;
		const bucketStartAt = bucketStartIso(at, bucketSizeSec);
		const requestedDimensionJson = normalizeDimensions(input.dimensions);
		const dimensionJson = await this.dimensionJsonForWrite({
			siteKey,
			metricKey: input.metricKey,
			bucketStartAt,
			bucketSizeSec,
			requestedDimensionJson,
		});
		const timestamp = nowIso();
		const id = createRollupId();
		await this.db
			.insert(taskMetricRollups)
			.values({
				id,
				siteId: input.siteId ?? null,
				siteKey,
				metricKey: input.metricKey,
				bucketStartAt,
				bucketSizeSec,
				dimensionJson,
				value: input.value ?? 1,
				sampleCount: input.sampleCount ?? 1,
				createdAt: timestamp,
				updatedAt: timestamp,
			})
			.onConflictDoUpdate({
				target: [
					taskMetricRollups.siteKey,
					taskMetricRollups.metricKey,
					taskMetricRollups.bucketStartAt,
					taskMetricRollups.bucketSizeSec,
					taskMetricRollups.dimensionJson,
				],
				set: {
					value: sql`${taskMetricRollups.value} + ${input.value ?? 1}`,
					sampleCount: sql`${taskMetricRollups.sampleCount} + ${
						input.sampleCount ?? 1
					}`,
					updatedAt: timestamp,
				},
			});
		return this.getByBucket({
			siteKey,
			metricKey: input.metricKey,
			bucketStartAt,
			bucketSizeSec,
			dimensionJson,
		});
	}

	public async sumWindow(input: TaskMetricWindowInput) {
		const bucketSizeSec = input.bucketSizeSec ?? DEFAULT_BUCKET_SIZE_SEC;
		const now = input.now ?? new Date();
		const windowStart = new Date(now.getTime() - input.windowSec * 1000);
		const siteKey = input.siteKey ?? GLOBAL_SITE_KEY;
		const dimensionJson =
			input.dimensions === undefined
				? undefined
				: normalizeDimensions(input.dimensions);
		const [row] = await this.db
			.select({
				value: sql<number>`coalesce(sum(${taskMetricRollups.value}), 0)`,
				sampleCount: sql<number>`coalesce(sum(${taskMetricRollups.sampleCount}), 0)`,
			})
			.from(taskMetricRollups)
			.where(
				and(
					eq(taskMetricRollups.siteKey, siteKey),
					eq(taskMetricRollups.metricKey, input.metricKey),
					eq(taskMetricRollups.bucketSizeSec, bucketSizeSec),
					gte(taskMetricRollups.bucketStartAt, windowStart.toISOString()),
					lte(taskMetricRollups.bucketStartAt, now.toISOString()),
					dimensionJson === undefined
						? undefined
						: eq(taskMetricRollups.dimensionJson, dimensionJson),
				),
			);
		return {
			metricKey: input.metricKey,
			windowSec: input.windowSec,
			bucketSizeSec,
			value: Number(row?.value ?? 0),
			sampleCount: Number(row?.sampleCount ?? 0),
		};
	}

	public async cleanupDimensions(input: {
		beforeIso: string;
		metricKey?: string;
	}) {
		const result = await this.db
			.delete(taskMetricRollups)
			.where(
				and(
					lte(taskMetricRollups.bucketStartAt, input.beforeIso),
					input.metricKey
						? eq(taskMetricRollups.metricKey, input.metricKey)
						: undefined,
				),
			);
		return { deletedRows: result.changes };
	}

	private async dimensionJsonForWrite(input: {
		siteKey: string;
		metricKey: string;
		bucketStartAt: string;
		bucketSizeSec: number;
		requestedDimensionJson: string;
	}) {
		const existing = await this.getByBucket({
			siteKey: input.siteKey,
			metricKey: input.metricKey,
			bucketStartAt: input.bucketStartAt,
			bucketSizeSec: input.bucketSizeSec,
			dimensionJson: input.requestedDimensionJson,
		});
		if (existing) {
			return input.requestedDimensionJson;
		}
		const [row] = await this.db
			.select({ value: count() })
			.from(taskMetricRollups)
			.where(
				and(
					eq(taskMetricRollups.siteKey, input.siteKey),
					eq(taskMetricRollups.metricKey, input.metricKey),
					eq(taskMetricRollups.bucketStartAt, input.bucketStartAt),
					eq(taskMetricRollups.bucketSizeSec, input.bucketSizeSec),
				),
			);
		if (Number(row?.value ?? 0) >= this.maxDimensionsPerBucket) {
			return stringifyJson({ overflow: true });
		}
		return input.requestedDimensionJson;
	}

	private async getByBucket(input: {
		siteKey: string;
		metricKey: string;
		bucketStartAt: string;
		bucketSizeSec: number;
		dimensionJson: string;
	}) {
		const [row] = await this.db
			.select()
			.from(taskMetricRollups)
			.where(
				and(
					eq(taskMetricRollups.siteKey, input.siteKey),
					eq(taskMetricRollups.metricKey, input.metricKey),
					eq(taskMetricRollups.bucketStartAt, input.bucketStartAt),
					eq(taskMetricRollups.bucketSizeSec, input.bucketSizeSec),
					eq(taskMetricRollups.dimensionJson, input.dimensionJson),
				),
			)
			.limit(1);
		return row ?? null;
	}
}
