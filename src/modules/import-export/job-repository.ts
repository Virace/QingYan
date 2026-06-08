import { and, desc, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { importBatches, importRecords, pageThreads } from "../../db/schema";

export class ImportJobRepository {
	public constructor(public readonly database: AppDatabase) {}

	public async createBatch(input: {
		id: string;
		siteId: number;
		sourceType: string;
		sourceFileName: string;
		sourceHash: string;
		format: string;
		formatVersion: number;
		status: string;
		summaryJson: string;
		optionsJson: string;
	}) {
		await this.database.insert(importBatches).values(input);
		return this.getBatch(input.id);
	}

	public async getBatch(id: string) {
		const [batch] = await this.database
			.select()
			.from(importBatches)
			.where(eq(importBatches.id, id));
		return batch;
	}

	public async updateBatch(
		id: string,
		input: {
			status: string;
			summaryJson: string;
			optionsJson?: string;
			errorJson?: string | null;
		},
	) {
		await this.database
			.update(importBatches)
			.set({
				status: input.status,
				summaryJson: input.summaryJson,
				optionsJson: input.optionsJson,
				errorJson: input.errorJson,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(importBatches.id, id));
		return this.getBatch(id);
	}

	public async updateBackup(id: string, backup: unknown) {
		await this.database
			.update(importBatches)
			.set({
				backupJson: JSON.stringify(backup),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(importBatches.id, id));
		return this.getBatch(id);
	}

	public async listBatches(input: {
		siteId?: number;
		status?: string;
		sourceType?: string;
		limit: number;
	}) {
		const filters = [
			input.siteId ? eq(importBatches.siteId, input.siteId) : undefined,
			input.status ? eq(importBatches.status, input.status) : undefined,
			input.sourceType
				? eq(importBatches.sourceType, input.sourceType)
				: undefined,
		].filter((filter) => filter !== undefined);
		const query = this.database.select().from(importBatches).$dynamic();
		if (filters.length > 0) {
			query.where(and(...filters));
		}
		return query.orderBy(desc(importBatches.createdAt)).limit(input.limit);
	}

	public async listExistingPageKeys(siteId: number, pageKeys: string[]) {
		if (pageKeys.length === 0) {
			return new Set<string>();
		}
		const rows = await this.database
			.select({ pageKey: pageThreads.pageKey })
			.from(pageThreads)
			.where(
				and(
					eq(pageThreads.siteId, siteId),
					inArray(pageThreads.pageKey, pageKeys),
				),
			);
		return new Set(rows.map((row) => row.pageKey));
	}

	public async listExistingSourceKeys(
		siteId: number,
		sourceType: string,
		sourceKeys: string[],
	) {
		if (sourceKeys.length === 0) {
			return new Set<string>();
		}
		const rows = await this.database
			.select({ sourceKey: importRecords.sourceKey })
			.from(importRecords)
			.where(
				and(
					eq(importRecords.siteId, siteId),
					eq(importRecords.sourceType, sourceType),
					inArray(importRecords.sourceKey, sourceKeys),
				),
			);
		return new Set(rows.map((row) => row.sourceKey));
	}
}
