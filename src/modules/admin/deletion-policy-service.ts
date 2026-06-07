import { and, desc, eq, lte } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { delayedDeletions, sites } from "../../db/schema";
import { RuntimeSystemSettingsService } from "../system-settings/service";
import { AppError, ResourceNotFoundError } from "../shared/errors";

type DelayedDeletionRecord = typeof delayedDeletions.$inferSelect;

export interface DeletionPolicyRequestInput {
	resourceType: string;
	resourceId: string;
	siteId?: number | null;
	actorUserId?: number | null;
	metadata?: unknown;
	now?: Date;
	hardDelete: () => Promise<number> | number;
}

export interface RestoreDeletionInput {
	id: number;
	actorUserId: number;
	now?: Date;
	restore: (record: DelayedDeletionRecord) => Promise<number> | number;
}

export interface RunDueHardDeletesInput {
	now?: Date;
	hardDelete: (record: DelayedDeletionRecord) => Promise<number> | number;
}

export interface ListDelayedDeletionsInput {
	siteId?: number;
	status?: string;
	limit: number;
	offset: number;
}

function addDays(date: Date, days: number) {
	return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export class DeletionPolicyService {
	public constructor(private readonly db: AppDatabase) {}

	public async listDelayedDeletions(input: ListDelayedDeletionsInput) {
		const conditions = [
			input.siteId ? eq(delayedDeletions.siteId, input.siteId) : undefined,
			input.status ? eq(delayedDeletions.status, input.status) : undefined,
		];
		const rows = await this.db
			.select({
				id: delayedDeletions.id,
				resourceType: delayedDeletions.resourceType,
				resourceId: delayedDeletions.resourceId,
				siteId: delayedDeletions.siteId,
				siteKey: sites.siteKey,
				requestedByUserId: delayedDeletions.requestedByUserId,
				requestedAt: delayedDeletions.requestedAt,
				hardDeleteAfter: delayedDeletions.hardDeleteAfter,
				restoredByUserId: delayedDeletions.restoredByUserId,
				restoredAt: delayedDeletions.restoredAt,
				hardDeletedAt: delayedDeletions.hardDeletedAt,
				status: delayedDeletions.status,
				metadataJson: delayedDeletions.metadataJson,
				createdAt: delayedDeletions.createdAt,
				updatedAt: delayedDeletions.updatedAt,
			})
			.from(delayedDeletions)
			.leftJoin(sites, eq(sites.id, delayedDeletions.siteId))
			.where(and(...conditions))
			.orderBy(desc(delayedDeletions.createdAt), desc(delayedDeletions.id));

		return {
			items: rows
				.slice(input.offset, input.offset + input.limit)
				.map((row) => ({
					...row,
					metadata: parseMetadata(row.metadataJson),
					metadataJson: undefined,
				})),
			totalCount: rows.length,
			limit: input.limit,
			offset: input.offset,
		};
	}

	public async requestDeletion(input: DeletionPolicyRequestInput) {
		const now = input.now ?? new Date();
		const nowIso = now.toISOString();
		const settings = await new RuntimeSystemSettingsService(
			this.db,
		).getAdminSettings();
		const retentionDays = settings.deletion.retentionDays;
		const hardDeleteAfter = addDays(now, retentionDays).toISOString();
		const metadataJson =
			input.metadata === undefined ? null : JSON.stringify(input.metadata);

		if (retentionDays === 0) {
			const hardDeletedCount = await input.hardDelete();
			const [record] = await this.db
				.insert(delayedDeletions)
				.values({
					resourceType: input.resourceType,
					resourceId: input.resourceId,
					siteId: input.siteId ?? null,
					requestedByUserId: input.actorUserId ?? null,
					requestedAt: nowIso,
					hardDeleteAfter,
					hardDeletedAt: nowIso,
					status: "hard_deleted",
					metadataJson,
					updatedAt: nowIso,
				})
				.returning();
			return {
				mode: "immediate" as const,
				record,
				hardDeletedCount,
			};
		}

		const [record] = await this.db
			.insert(delayedDeletions)
			.values({
				resourceType: input.resourceType,
				resourceId: input.resourceId,
				siteId: input.siteId ?? null,
				requestedByUserId: input.actorUserId ?? null,
				requestedAt: nowIso,
				hardDeleteAfter,
				status: "pending",
				metadataJson,
				updatedAt: nowIso,
			})
			.returning();
		return {
			mode: "delayed" as const,
			record,
			hardDeletedCount: 0,
		};
	}

	public async restoreDeletion(input: RestoreDeletionInput) {
		const [record] = await this.db
			.select()
			.from(delayedDeletions)
			.where(eq(delayedDeletions.id, input.id))
			.limit(1);
		if (!record) {
			throw new ResourceNotFoundError(
				"DELAYED_DELETION_NOT_FOUND",
				"延迟删除记录不存在。",
			);
		}
		if (record.status !== "pending") {
			throw new AppError(
				409,
				"DELAYED_DELETION_NOT_PENDING",
				"延迟删除记录不处于待恢复状态。",
			);
		}

		await input.restore(record);
		const nowIso = (input.now ?? new Date()).toISOString();
		const [restored] = await this.db
			.update(delayedDeletions)
			.set({
				status: "restored",
				restoredByUserId: input.actorUserId,
				restoredAt: nowIso,
				updatedAt: nowIso,
			})
			.where(eq(delayedDeletions.id, input.id))
			.returning();
		return restored;
	}

	public async runDueHardDeletes(input: RunDueHardDeletesInput) {
		const nowIso = (input.now ?? new Date()).toISOString();
		const records = await this.db
			.select()
			.from(delayedDeletions)
			.where(
				and(
					eq(delayedDeletions.status, "pending"),
					lte(delayedDeletions.hardDeleteAfter, nowIso),
				),
			);

		let hardDeletedCount = 0;
		const recordsSummary: Array<{
			id: number;
			resourceType: string;
			resourceId: string;
			siteId: number | null;
			requestedByUserId: number | null;
			requestedAt: string;
			hardDeleteAfter: string;
			hardDeletedCount: number;
		}> = [];
		for (const record of records) {
			const recordHardDeletedCount = await input.hardDelete(record);
			hardDeletedCount += recordHardDeletedCount;
			recordsSummary.push({
				id: record.id,
				resourceType: record.resourceType,
				resourceId: record.resourceId,
				siteId: record.siteId,
				requestedByUserId: record.requestedByUserId,
				requestedAt: record.requestedAt,
				hardDeleteAfter: record.hardDeleteAfter,
				hardDeletedCount: recordHardDeletedCount,
			});
			await this.db
				.update(delayedDeletions)
				.set({
					status: "hard_deleted",
					hardDeletedAt: nowIso,
					updatedAt: nowIso,
				})
				.where(eq(delayedDeletions.id, record.id));
		}

		return {
			processedCount: records.length,
			hardDeletedCount,
			hardDeletedAt: nowIso,
			records: recordsSummary,
		};
	}
}

function parseMetadata(metadataJson: string | null) {
	if (!metadataJson) {
		return null;
	}
	try {
		return JSON.parse(metadataJson) as unknown;
	} catch {
		return null;
	}
}
