import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { maintenanceJobs } from "../../db/schema";

export type MaintenanceJobType =
	| "ip_region_update"
	| "comment_ip_refresh"
	| "page_source_refresh"
	| "page_metadata_refresh";
export type MaintenanceJobStatus =
	| "queued"
	| "delayed"
	| "running"
	| "retrying"
	| "succeeded"
	| "failed"
	| "cancelled";

export interface MaintenanceJobRecord {
	id: string;
	type: MaintenanceJobType;
	status: MaintenanceJobStatus;
	siteKey: string | null;
	scope: unknown;
	progress: unknown;
	result: unknown;
	error: unknown;
	runAfter: string | null;
	attempts: number;
	maxAttempts: number;
	retryDelaySec: number;
	concurrencyKey: string | null;
	lastHeartbeatAt: string | null;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	updatedAt: string;
}

export interface RunnableJobOptions {
	nowIso?: string;
	limit?: number;
	maxConcurrentTotal?: number;
	maxConcurrentByType?: Partial<Record<MaintenanceJobType, number>>;
}

function nowIso(): string {
	return new Date().toISOString();
}

function parseJson(value: string | null): unknown {
	return value ? (JSON.parse(value) as unknown) : null;
}

function serialize(
	row: typeof maintenanceJobs.$inferSelect,
): MaintenanceJobRecord {
	return {
		id: row.id,
		type: row.type as MaintenanceJobType,
		status: row.status as MaintenanceJobStatus,
		siteKey: row.siteKey,
		scope: JSON.parse(row.scopeJson) as unknown,
		progress: parseJson(row.progressJson),
		result: parseJson(row.resultJson),
		error: parseJson(row.errorJson),
		runAfter: row.runAfter,
		attempts: row.attempts,
		maxAttempts: row.maxAttempts,
		retryDelaySec: row.retryDelaySec,
		concurrencyKey: row.concurrencyKey,
		lastHeartbeatAt: row.lastHeartbeatAt,
		createdAt: row.createdAt,
		startedAt: row.startedAt,
		finishedAt: row.finishedAt,
		updatedAt: row.updatedAt,
	};
}

export class MaintenanceJobRepository {
	public constructor(private readonly db: AppDatabase) {}

	public async create(input: {
		type: MaintenanceJobType;
		scope: unknown;
		siteKey?: string | null;
		runAfter?: string | null;
		maxAttempts?: number;
		retryDelaySec?: number;
		concurrencyKey?: string | null;
	}) {
		const timestamp = nowIso();
		const id = `maintenance_${randomUUID().replaceAll("-", "")}`;
		const runAfter = input.runAfter ?? null;
		await this.db.insert(maintenanceJobs).values({
			id,
			type: input.type,
			status: runAfter && runAfter > timestamp ? "delayed" : "queued",
			siteKey: input.siteKey ?? null,
			scopeJson: JSON.stringify(input.scope),
			runAfter,
			maxAttempts: input.maxAttempts ?? 1,
			retryDelaySec: input.retryDelaySec ?? 0,
			concurrencyKey: input.concurrencyKey ?? null,
			createdAt: timestamp,
			updatedAt: timestamp,
		});
		return this.getRequired(id);
	}

	public async get(id: string) {
		const [row] = await this.db
			.select()
			.from(maintenanceJobs)
			.where(eq(maintenanceJobs.id, id))
			.limit(1);
		return row ? serialize(row) : null;
	}

	public async getRequired(id: string) {
		const job = await this.get(id);
		if (!job) {
			throw new Error(`Maintenance job not found: ${id}`);
		}
		return job;
	}

	public async listRecent(limit = 10) {
		const rows = await this.db
			.select()
			.from(maintenanceJobs)
			.orderBy(desc(maintenanceJobs.createdAt))
			.limit(limit);
		return rows.map(serialize);
	}

	public async listRunnable(options: RunnableJobOptions = {}) {
		const now = options.nowIso ?? nowIso();
		const limit = options.limit ?? 10;
		const maxConcurrentTotal = options.maxConcurrentTotal ?? 1;
		const running = await this.db
			.select()
			.from(maintenanceJobs)
			.where(eq(maintenanceJobs.status, "running"));
		if (running.length >= maxConcurrentTotal) {
			return [];
		}
		const runningByType = new Map<MaintenanceJobType, number>();
		const runningKeys = new Set<string>();
		for (const row of running) {
			const type = row.type as MaintenanceJobType;
			runningByType.set(type, (runningByType.get(type) ?? 0) + 1);
			if (row.concurrencyKey) {
				runningKeys.add(row.concurrencyKey);
			}
		}

		const rows = await this.db
			.select()
			.from(maintenanceJobs)
			.where(
				and(
					inArray(maintenanceJobs.status, ["queued", "delayed", "retrying"]),
					or(
						isNull(maintenanceJobs.runAfter),
						lte(maintenanceJobs.runAfter, now),
					),
				),
			)
			.orderBy(maintenanceJobs.createdAt)
			.limit(limit);

		const selected: MaintenanceJobRecord[] = [];
		for (const row of rows) {
			const job = serialize(row);
			const typeLimit = options.maxConcurrentByType?.[job.type];
			if (
				typeLimit !== undefined &&
				(runningByType.get(job.type) ?? 0) >= typeLimit
			) {
				continue;
			}
			if (job.concurrencyKey && runningKeys.has(job.concurrencyKey)) {
				continue;
			}
			selected.push(job);
		}
		return selected;
	}

	public async hasActiveJob(input?: {
		type?: MaintenanceJobType;
		concurrencyKey?: string;
	}) {
		const [row] = await this.db
			.select()
			.from(maintenanceJobs)
			.where(
				and(
					inArray(maintenanceJobs.status, [
						"queued",
						"delayed",
						"retrying",
						"running",
					]),
					input?.type ? eq(maintenanceJobs.type, input.type) : undefined,
					input?.concurrencyKey
						? eq(maintenanceJobs.concurrencyKey, input.concurrencyKey)
						: undefined,
				),
			)
			.limit(1);
		return Boolean(row);
	}

	public async markRunning(id: string, progress: unknown) {
		const timestamp = nowIso();
		await this.db
			.update(maintenanceJobs)
			.set({
				status: "running",
				startedAt: timestamp,
				lastHeartbeatAt: timestamp,
				progressJson: JSON.stringify(progress),
				updatedAt: timestamp,
			})
			.where(eq(maintenanceJobs.id, id));
		return this.getRequired(id);
	}

	public async updateProgress(id: string, progress: unknown) {
		const timestamp = nowIso();
		await this.db
			.update(maintenanceJobs)
			.set({
				progressJson: JSON.stringify(progress),
				lastHeartbeatAt: timestamp,
				updatedAt: timestamp,
			})
			.where(eq(maintenanceJobs.id, id));
	}

	public async markSucceeded(id: string, result: unknown) {
		const timestamp = nowIso();
		await this.db
			.update(maintenanceJobs)
			.set({
				status: "succeeded",
				resultJson: JSON.stringify(result),
				finishedAt: timestamp,
				updatedAt: timestamp,
			})
			.where(eq(maintenanceJobs.id, id));
		return this.getRequired(id);
	}

	public async markFailed(id: string, error: unknown) {
		const timestamp = nowIso();
		await this.db
			.update(maintenanceJobs)
			.set({
				status: "failed",
				errorJson: JSON.stringify(error),
				finishedAt: timestamp,
				updatedAt: timestamp,
			})
			.where(eq(maintenanceJobs.id, id));
		return this.getRequired(id);
	}

	public async markFailedOrRetry(
		id: string,
		input: { error: unknown; nowIso?: string },
	) {
		const timestamp = input.nowIso ?? nowIso();
		const job = await this.getRequired(id);
		const nextAttempts = job.attempts + 1;
		if (nextAttempts < job.maxAttempts) {
			const runAfter = new Date(
				new Date(timestamp).getTime() + job.retryDelaySec * 1000,
			).toISOString();
			await this.db
				.update(maintenanceJobs)
				.set({
					status: "retrying",
					attempts: nextAttempts,
					runAfter,
					errorJson: JSON.stringify(input.error),
					updatedAt: timestamp,
				})
				.where(eq(maintenanceJobs.id, id));
			return this.getRequired(id);
		}

		await this.db
			.update(maintenanceJobs)
			.set({
				status: "failed",
				attempts: nextAttempts,
				errorJson: JSON.stringify(input.error),
				finishedAt: timestamp,
				updatedAt: timestamp,
			})
			.where(eq(maintenanceJobs.id, id));
		return this.getRequired(id);
	}
}
