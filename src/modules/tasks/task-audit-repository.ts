import { and, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";

import type { DatabaseExecutor } from "../../db/client";
import { auditLogs } from "../../db/schema";
import { type TaskListQuery, taskTextSearch } from "./task-list-query";

export class TaskAuditRepository {
	public constructor(private readonly db: DatabaseExecutor) {}

	public async list(
		input: TaskListQuery & {
			allowedSiteIds?: number[];
			searchTypes?: string[];
		},
	) {
		const taskType = sql`${auditLogs.payloadJson} ->> 'taskType'`;
		const whereCondition = and(
			like(auditLogs.action, "task.%"),
			input.allowedSiteIds
				? and(
						eq(auditLogs.actorType, "admin_user"),
						inArray(auditLogs.siteId, input.allowedSiteIds),
					)
				: undefined,
			input.search?.trim()
				? or(
						taskTextSearch(input.search, [
							auditLogs.action,
							auditLogs.actorType,
							auditLogs.actorId,
							auditLogs.targetType,
							auditLogs.targetId,
							sql`${auditLogs.payloadJson} ->> 'taskName'`,
							taskType,
							sql`${auditLogs.payloadJson} ->> 'siteKey'`,
							sql`${auditLogs.payloadJson} ->> 'runId'`,
							sql`${auditLogs.payloadJson} ->> 'scheduledTaskId'`,
						]),
						input.searchTypes?.length
							? inArray(taskType, input.searchTypes)
							: undefined,
					)
				: undefined,
		);
		const items = await this.db
			.select()
			.from(auditLogs)
			.where(whereCondition)
			.orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
			.limit(input.limit ?? 200)
			.offset(input.offset ?? 0);
		const [total] = await this.db
			.select({ value: count() })
			.from(auditLogs)
			.where(whereCondition);
		return { items, totalCount: Number(total?.value ?? 0) };
	}
}
