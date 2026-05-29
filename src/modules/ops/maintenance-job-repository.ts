import { randomUUID } from "node:crypto";

import {
	and,
	count,
	desc,
	eq,
	inArray,
	isNull,
	lte,
	or,
	sql,
} from "drizzle-orm";

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
export type MaintenanceWaitingReason =
	| "ready_for_runner"
	| "delayed_until_run_after"
	| "global_concurrency_limit"
	| "type_concurrency_limit"
	| "concurrency_key_blocked"
	| "retry_wait"
	| "terminal";

export interface MaintenanceQueueState {
	waitingReason: MaintenanceWaitingReason;
	waitingDescription: string;
	blockedByJobId?: string;
	readyAt: string | null;
}

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
	priority: number;
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
		priority: row.priority,
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
			priority: 0,
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

	public async listForTaskCenter(input: {
		siteKey?: string;
		type?: MaintenanceJobType;
		status?: MaintenanceJobStatus;
		limit: number;
		offset: number;
	}) {
		const whereCondition = and(
			input.siteKey ? eq(maintenanceJobs.siteKey, input.siteKey) : undefined,
			input.type ? eq(maintenanceJobs.type, input.type) : undefined,
			input.status ? eq(maintenanceJobs.status, input.status) : undefined,
		);
		const rows = await this.db
			.select()
			.from(maintenanceJobs)
			.where(whereCondition)
			.orderBy(desc(maintenanceJobs.createdAt))
			.limit(input.limit)
			.offset(input.offset);
		const [total] = await this.db
			.select({ value: count() })
			.from(maintenanceJobs)
			.where(whereCondition);
		return {
			items: rows.map(serialize),
			totalCount: Number(total?.value ?? 0),
		};
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
			.orderBy(
				desc(maintenanceJobs.priority),
				sql`CASE WHEN ${maintenanceJobs.runAfter} IS NULL THEN 1 ELSE 0 END`,
				maintenanceJobs.runAfter,
				maintenanceJobs.createdAt,
			)
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

	public async describeQueueState(
		job: MaintenanceJobRecord,
		options: RunnableJobOptions = {},
	): Promise<MaintenanceQueueState> {
		const now = options.nowIso ?? nowIso();
		if (["succeeded", "failed", "cancelled"].includes(job.status)) {
			return {
				waitingReason: "terminal",
				waitingDescription: "任务已经结束。",
				readyAt: null,
			};
		}
		if (job.runAfter && job.runAfter > now) {
			return {
				waitingReason:
					job.status === "retrying" ? "retry_wait" : "delayed_until_run_after",
				waitingDescription:
					job.status === "retrying"
						? `任务等待重试，下一次可执行时间为 ${job.runAfter}。`
						: `任务设置了延迟执行，预计 ${job.runAfter} 后可运行。`,
				readyAt: job.runAfter,
			};
		}
		const running = await this.db
			.select()
			.from(maintenanceJobs)
			.where(eq(maintenanceJobs.status, "running"));
		const maxConcurrentTotal = options.maxConcurrentTotal ?? 1;
		if (running.length >= maxConcurrentTotal) {
			return {
				waitingReason: "global_concurrency_limit",
				waitingDescription: "全局运行任务数已达到上限，任务正在排队。",
				readyAt: null,
			};
		}
		const typeLimit = options.maxConcurrentByType?.[job.type];
		const runningSameType = running.filter((row) => row.type === job.type);
		if (typeLimit !== undefined && runningSameType.length >= typeLimit) {
			return {
				waitingReason: "type_concurrency_limit",
				waitingDescription: "同类型运行任务数已达到上限，任务正在排队。",
				readyAt: null,
			};
		}
		if (job.concurrencyKey) {
			const blocking = running.find(
				(row) => row.concurrencyKey === job.concurrencyKey,
			);
			if (blocking) {
				return {
					waitingReason: "concurrency_key_blocked",
					waitingDescription: "同一互斥键已有任务运行，当前任务必须等待。",
					blockedByJobId: blocking.id,
					readyAt: null,
				};
			}
		}
		return {
			waitingReason: "ready_for_runner",
			waitingDescription: "任务已满足运行条件，正在等待 runner 拉取。",
			readyAt: now,
		};
	}

	public async runNow(id: string) {
		const timestamp = nowIso();
		const job = await this.getRequired(id);
		if (!["delayed", "retrying", "queued"].includes(job.status)) {
			return job;
		}
		await this.db
			.update(maintenanceJobs)
			.set({
				status: "queued",
				runAfter: null,
				updatedAt: timestamp,
			})
			.where(eq(maintenanceJobs.id, id));
		return this.getRequired(id);
	}

	public async prioritize(id: string) {
		const timestamp = nowIso();
		const job = await this.getRequired(id);
		if (!["queued", "delayed", "retrying"].includes(job.status)) {
			return job;
		}
		await this.db
			.update(maintenanceJobs)
			.set({
				priority: job.priority + 1,
				updatedAt: timestamp,
			})
			.where(eq(maintenanceJobs.id, id));
		return this.getRequired(id);
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
