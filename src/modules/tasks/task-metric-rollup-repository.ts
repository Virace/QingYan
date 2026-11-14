import { randomUUID } from "node:crypto";

import { and, count, eq, gte, isNull, lte, sql } from "drizzle-orm";

import type { DatabaseExecutor } from "../../db/client";
import { taskMetricRollups } from "../../db/schema";
import {
	advisoryLockKey,
	canonicalJson,
	hashKey,
	toSafeInteger,
} from "../../db/values";

const DEFAULT_BUCKET_SIZE_SEC = 60;
const DEFAULT_MAX_DIMENSIONS_PER_BUCKET = 100;
const OVERFLOW_DIMENSIONS = canonicalJson({ overflow: true });

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

type Bucket = {
	siteKey: string | null;
	metricKey: string;
	bucketStartAt: string;
	bucketSizeSec: number;
};

function bucketCondition(bucket: Bucket) {
	return and(
		bucket.siteKey === null
			? isNull(taskMetricRollups.siteKey)
			: eq(taskMetricRollups.siteKey, bucket.siteKey),
		eq(taskMetricRollups.metricKey, bucket.metricKey),
		eq(taskMetricRollups.bucketStartAt, bucket.bucketStartAt),
		eq(taskMetricRollups.bucketSizeSec, bucket.bucketSizeSec),
	);
}

export class TaskMetricRollupRepository {
	private readonly maxDimensionsPerBucket: number;

	public constructor(
		private readonly db: DatabaseExecutor,
		options?: { maxDimensionsPerBucket?: number },
	) {
		this.maxDimensionsPerBucket =
			options?.maxDimensionsPerBucket ?? DEFAULT_MAX_DIMENSIONS_PER_BUCKET;
	}

	public async increment(input: TaskMetricIncrementInput) {
		const bucketSizeSec = input.bucketSizeSec ?? DEFAULT_BUCKET_SIZE_SEC;
		const at = input.at ?? new Date();
		const bucket: Bucket = {
			siteKey: input.siteKey ?? null,
			metricKey: input.metricKey,
			bucketSizeSec,
			bucketStartAt: new Date(
				Math.floor(at.getTime() / (bucketSizeSec * 1000)) *
					bucketSizeSec *
					1000,
			).toISOString(),
		};
		const requested = canonicalJson(input.dimensions ?? {});
		const timestamp = new Date().toISOString();
		const increment = {
			value: sql`${taskMetricRollups.value} + ${input.value ?? 1}`,
			sampleCount: sql`${taskMetricRollups.sampleCount} + ${input.sampleCount ?? 1}`,
			updatedAt: timestamp,
		};
		const updateExisting = async (
			db: DatabaseExecutor,
			dimensionJson: string,
		) => {
			const [row] = await db
				.update(taskMetricRollups)
				.set(increment)
				.where(
					and(
						bucketCondition(bucket),
						eq(taskMetricRollups.dimensionHash, hashKey(dimensionJson)),
						sql`${taskMetricRollups.dimensionJson} = ${dimensionJson}::jsonb`,
					),
				)
				.returning();
			return row;
		};
		const existing = await updateExisting(this.db, requested);
		if (existing) return existing;
		return this.db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(${advisoryLockKey("metric-bucket", canonicalJson(bucket))}::bigint)`,
			);
			// READ COMMITTED 的独立语句能看到等待桶锁期间已提交的新维度。
			const existingAfterLock = await updateExisting(tx, requested);
			if (existingAfterLock) return existingAfterLock;
			const [dimensionCount] = await tx
				.select({ value: count() })
				.from(taskMetricRollups)
				.where(
					and(
						bucketCondition(bucket),
						sql`${taskMetricRollups.dimensionJson} <> ${OVERFLOW_DIMENSIONS}::jsonb`,
					),
				);
			const dimensionJson =
				Number(dimensionCount.value) >= this.maxDimensionsPerBucket
					? OVERFLOW_DIMENSIONS
					: requested;
			const [row] = await tx
				.insert(taskMetricRollups)
				.values({
					id: `task_metric_${randomUUID().replaceAll("-", "")}`,
					...bucket,
					siteId: input.siteId ?? null,
					dimensionJson,
					dimensionHash: hashKey(dimensionJson),
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
						taskMetricRollups.dimensionHash,
					],
					set: increment,
					setWhere: sql`${taskMetricRollups.dimensionJson} = ${dimensionJson}::jsonb`,
				})
				.returning();
			if (!row) throw new Error("Metric dimension digest collision");
			return row;
		});
	}

	public async sumWindow(input: TaskMetricWindowInput) {
		const bucketSizeSec = input.bucketSizeSec ?? DEFAULT_BUCKET_SIZE_SEC;
		const now = input.now ?? new Date();
		const siteKey = input.siteKey ?? null;
		const dimensions =
			input.dimensions === undefined
				? undefined
				: canonicalJson(input.dimensions);
		const [row] = await this.db
			.select({
				value: sql<number>`coalesce(sum(${taskMetricRollups.value}), 0)`,
				sampleCount: sql<string>`coalesce(sum(${taskMetricRollups.sampleCount}), 0)`,
			})
			.from(taskMetricRollups)
			.where(
				and(
					siteKey === null
						? isNull(taskMetricRollups.siteKey)
						: eq(taskMetricRollups.siteKey, siteKey),
					eq(taskMetricRollups.metricKey, input.metricKey),
					eq(taskMetricRollups.bucketSizeSec, bucketSizeSec),
					gte(
						taskMetricRollups.bucketStartAt,
						new Date(now.getTime() - input.windowSec * 1000).toISOString(),
					),
					lte(taskMetricRollups.bucketStartAt, now.toISOString()),
					dimensions === undefined
						? undefined
						: and(
								eq(taskMetricRollups.dimensionHash, hashKey(dimensions)),
								sql`${taskMetricRollups.dimensionJson} = ${dimensions}::jsonb`,
							),
				),
			);
		return {
			metricKey: input.metricKey,
			windowSec: input.windowSec,
			bucketSizeSec,
			value: Number(row?.value ?? 0),
			sampleCount: toSafeInteger(row?.sampleCount ?? 0),
		};
	}

	public async cleanupDimensions(input: {
		beforeIso: string;
		metricKey?: string;
	}) {
		const rows = await this.db
			.delete(taskMetricRollups)
			.where(
				and(
					lte(taskMetricRollups.bucketStartAt, input.beforeIso),
					input.metricKey
						? eq(taskMetricRollups.metricKey, input.metricKey)
						: undefined,
				),
			)
			.returning({ id: taskMetricRollups.id });
		return { deletedRows: rows.length };
	}
}
