import { and, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { pageFeedbackRecords, pageThreads } from "../../db/schema";

export class PageFeedbackRepository {
	public constructor(private readonly db: AppDatabase) {}

	public getDatabase(): AppDatabase {
		return this.db;
	}

	public async getLikeRecord(pageThreadId: number, visitorId: number) {
		const [record] = await this.db
			.select()
			.from(pageFeedbackRecords)
			.where(
				and(
					eq(pageFeedbackRecords.pageThreadId, pageThreadId),
					eq(pageFeedbackRecords.visitorId, visitorId),
				),
			)
			.limit(1);

		return record;
	}

	public async createLike(pageThreadId: number, visitorId: number) {
		await this.db.insert(pageFeedbackRecords).values({
			pageThreadId,
			visitorId,
		});

		await this.db
			.update(pageThreads)
			.set({
				pageLikeCount: sql`${pageThreads.pageLikeCount} + 1`,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(pageThreads.id, pageThreadId));

		const [thread] = await this.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.id, pageThreadId))
			.limit(1);

		return thread;
	}
}
