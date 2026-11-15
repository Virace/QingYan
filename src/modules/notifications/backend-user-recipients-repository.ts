import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { DatabaseExecutor } from "../../db/client";
import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
} from "../../db/schema";
import type { NotificationChannelType } from "./channel-configs-repository";
export type BackendUserNotificationChannel = NotificationChannelType;
export type BackendUserNotificationEventType =
	| "admin_comment_pending"
	| "admin_comment_approved";
export type BackendUserIncludeCommentContent = "none" | "summary" | "full";
export class BackendUserNotificationRecipientsRepository {
	public constructor(private readonly db: DatabaseExecutor) {}
	public async getUserForRecipientValidation(input: {
		userId: number;
		siteId: number;
	}) {
		const [row] = await this.db
			.select({
				id: adminUsers.id,
				username: adminUsers.username,
				email: adminUsers.email,
				status: adminUsers.status,
				deletedAt: adminUsers.deletedAt,
				groupKey: adminGroups.key,
				siteAccessId: adminUserSiteAccess.id,
			})
			.from(adminUsers)
			.innerJoin(adminUserGroups, eq(adminUserGroups.userId, adminUsers.id))
			.innerJoin(adminGroups, eq(adminGroups.id, adminUserGroups.groupId))
			.leftJoin(
				adminUserSiteAccess,
				and(
					eq(adminUserSiteAccess.userId, adminUsers.id),
					eq(adminUserSiteAccess.siteId, input.siteId),
				),
			)
			.where(eq(adminUsers.id, input.userId))
			.limit(1);

		return row;
	}

	public async listActiveSiteRecipientUsers(input: {
		siteId: number;
		userIds: number[];
	}) {
		if (input.userIds.length === 0) {
			return [];
		}
		return this.db
			.select({
				id: adminUsers.id,
				username: adminUsers.username,
				email: adminUsers.email,
				displayName: adminUsers.displayName,
			})
			.from(adminUsers)
			.innerJoin(adminUserGroups, eq(adminUserGroups.userId, adminUsers.id))
			.innerJoin(adminGroups, eq(adminGroups.id, adminUserGroups.groupId))
			.leftJoin(
				adminUserSiteAccess,
				and(
					eq(adminUserSiteAccess.userId, adminUsers.id),
					eq(adminUserSiteAccess.siteId, input.siteId),
				),
			)
			.where(
				and(
					inArray(adminUsers.id, input.userIds),
					eq(adminUsers.status, "active"),
					isNull(adminUsers.deletedAt),
					or(eq(adminGroups.key, "admin"), isNotNull(adminUserSiteAccess.id)),
				),
			);
	}
}
