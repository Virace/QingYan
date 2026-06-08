import type { FastifyRequest } from "fastify";

import type { SiteRegistry } from "../shared/site-registry";
import { AppError, ResourceNotFoundError } from "../shared/errors";
import type { AuthenticatedAdminSession } from "./session-service";
import type { AdminPermission } from "./permissions";

export function requirePermission(
	session: AuthenticatedAdminSession,
	permission: AdminPermission,
) {
	if (!session.permissions.includes(permission)) {
		throw new AppError(403, "ADMIN_PERMISSION_REQUIRED", "缺少后台权限。", {
			permission,
		});
	}
}

export function requireSiteAccess(input: {
	session: AuthenticatedAdminSession;
	siteRegistry: SiteRegistry;
	siteKey?: string;
	permission?: AdminPermission;
}) {
	if (input.permission) {
		requirePermission(input.session, input.permission);
	}
	if (!input.siteKey) {
		if (!input.session.isAdmin) {
			throw new AppError(403, "ADMIN_SITE_ACCESS_REQUIRED", "没有该站点权限。");
		}
		return undefined;
	}

	const site = input.siteRegistry.getRegisteredSite(input.siteKey);
	if (!site) {
		throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
	}
	if (input.session.isAdmin || input.session.siteIds.includes(site.id)) {
		return site;
	}

	throw new AppError(403, "ADMIN_SITE_ACCESS_REQUIRED", "没有该站点权限。", {
		siteKey: input.siteKey,
	});
}

export function requireSiteIdAccess(input: {
	session: AuthenticatedAdminSession;
	siteId?: number | null;
	permission?: AdminPermission;
}) {
	if (input.permission) {
		requirePermission(input.session, input.permission);
	}
	if (input.session.isAdmin) {
		return;
	}
	if (!input.siteId || !input.session.siteIds.includes(input.siteId)) {
		throw new AppError(403, "ADMIN_SITE_ACCESS_REQUIRED", "没有该站点权限。");
	}
}

export function requireInitialAdmin(session: AuthenticatedAdminSession) {
	if (!session.isInitialAdmin) {
		throw new AppError(
			403,
			"ADMIN_INITIAL_ADMIN_REQUIRED",
			"需要初始管理员权限。",
		);
	}
}

export function requireCanTargetUser(input: {
	session: AuthenticatedAdminSession;
	target: {
		id: number;
		groupKey: string;
		isInitialAdmin: boolean;
	};
}) {
	if (input.session.user.id === input.target.id) {
		return;
	}
	if (input.target.isInitialAdmin) {
		throw new AppError(
			403,
			"ADMIN_TARGET_USER_FORBIDDEN",
			"不能管理初始管理员。",
		);
	}
	if (input.target.groupKey === "admin" || input.target.isInitialAdmin) {
		requireInitialAdmin(input.session);
	}
}

export async function requireAdminRequest(input: {
	request: FastifyRequest;
	session: AuthenticatedAdminSession;
	permission: AdminPermission;
}) {
	requirePermission(input.session, input.permission);
	return input.session;
}
