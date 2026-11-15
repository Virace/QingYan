import { and, eq, sql } from "drizzle-orm";

import { AppError } from "../shared/errors";

import type { DatabaseExecutor } from "../../db/client";
import { pageFeedbackRecords, pageThreads } from "../../db/schema";

export class PageFeedbackRepository {
	public constructor(private readonly db: DatabaseExecutor) {}

	public getDatabase(): DatabaseExecutor {
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
		return this.db.transaction(async (tx) => {
			const [inserted] = await tx
				.insert(pageFeedbackRecords)
				.values({
					pageThreadId,
					visitorId,
				})
				.onConflictDoNothing({
					target: [
						pageFeedbackRecords.pageThreadId,
						pageFeedbackRecords.visitorId,
					],
				})
				.returning({ id: pageFeedbackRecords.id });
			if (!inserted)
				throw new AppError(
					409,
					"PAGE_FEEDBACK_ALREADY_LIKED",
					"你已经点过赞了。",
				);

			const [thread] = await tx
				.update(pageThreads)
				.set({
					pageLikeCount: sql`${pageThreads.pageLikeCount} + 1`,
					updatedAt: new Date().toISOString(),
				})
				.where(eq(pageThreads.id, pageThreadId))
				.returning();

			return thread;
		});
	}

	public async incrementPageLike(pageThreadId: number) {
		const [thread] = await this.db
			.update(pageThreads)
			.set({
				pageLikeCount: sql`${pageThreads.pageLikeCount} + 1`,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(pageThreads.id, pageThreadId))
			.returning();

		return thread;
	}
}
