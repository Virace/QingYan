import { and, eq, isNull } from "drizzle-orm";
import type { DatabaseExecutor } from "../../db/client";
import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
} from "../../db/schema";
import { isAdminGroupKey, permissionsForGroup } from "../admin/permissions";
import { AppError } from "../shared/errors";

export async function requireCommentAccount(
	db: DatabaseExecutor,
	userId: number,
	siteId: number,
) {
	const [user] = await db
		.select()
		.from(adminUsers)
		.where(
			and(
				eq(adminUsers.id, userId),
				eq(adminUsers.status, "active"),
				isNull(adminUsers.deletedAt),
			),
		)
		.limit(1);
	if (!user)
		throw new AppError(401, "ADMIN_AUTH_REQUIRED", "请重新登录后使用该邮箱。");
	const memberships = await db
		.select({ key: adminGroups.key })
		.from(adminUserGroups)
		.innerJoin(adminGroups, eq(adminGroups.id, adminUserGroups.groupId))
		.where(eq(adminUserGroups.userId, userId));
	const isAdmin = memberships.some(({ key }) => key === "admin");
	const canReply = memberships.some(
		({ key }) =>
			isAdminGroupKey(key) &&
			permissionsForGroup(key).includes("comments.reply"),
	);
	const access = isAdmin
		? true
		: (
				await db
					.select({ siteId: adminUserSiteAccess.siteId })
					.from(adminUserSiteAccess)
					.where(
						and(
							eq(adminUserSiteAccess.userId, userId),
							eq(adminUserSiteAccess.siteId, siteId),
						),
					)
					.limit(1)
			).length > 0;
	if (!canReply || !access)
		throw new AppError(
			403,
			"ADMIN_SITE_ACCESS_REQUIRED",
			"当前账号没有在该站点发言的权限。",
		);
	return user;
}
