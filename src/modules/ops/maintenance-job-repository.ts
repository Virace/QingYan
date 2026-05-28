import { randomUUID } from "node:crypto";

import { desc, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { maintenanceJobs } from "../../db/schema";

export type MaintenanceJobType = "ip_region_update" | "comment_ip_refresh";
export type MaintenanceJobStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled";

export interface MaintenanceJobRecord {
	id: string;
	type: MaintenanceJobType;
	status: MaintenanceJobStatus;
	scope: unknown;
	progress: unknown;
	result: unknown;
	error: unknown;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	updatedAt: string;
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
		scope: JSON.parse(row.scopeJson) as unknown,
		progress: parseJson(row.progressJson),
		result: parseJson(row.resultJson),
		error: parseJson(row.errorJson),
		createdAt: row.createdAt,
		startedAt: row.startedAt,
		finishedAt: row.finishedAt,
		updatedAt: row.updatedAt,
	};
}

export class MaintenanceJobRepository {
	public constructor(private readonly db: AppDatabase) {}

	public async create(input: { type: MaintenanceJobType; scope: unknown }) {
		const timestamp = nowIso();
		const id = `maintenance_${randomUUID().replaceAll("-", "")}`;
		await this.db.insert(maintenanceJobs).values({
			id,
			type: input.type,
			status: "queued",
			scopeJson: JSON.stringify(input.scope),
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

	public async hasActiveJob() {
		const [row] = await this.db
			.select()
			.from(maintenanceJobs)
			.where(inArray(maintenanceJobs.status, ["queued", "running"]))
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
				progressJson: JSON.stringify(progress),
				updatedAt: timestamp,
			})
			.where(eq(maintenanceJobs.id, id));
		return this.getRequired(id);
	}

	public async updateProgress(id: string, progress: unknown) {
		await this.db
			.update(maintenanceJobs)
			.set({
				progressJson: JSON.stringify(progress),
				updatedAt: nowIso(),
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
}
