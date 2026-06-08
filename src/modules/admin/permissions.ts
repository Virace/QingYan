export type AdminGroupKey =
	| "admin"
	| "site_admin"
	| "site_moderator"
	| "system_builtin";

export type AdminPermission =
	| "system_settings.read"
	| "system_settings.update"
	| "sites.read"
	| "sites.create"
	| "sites.update"
	| "sites.delete"
	| "site_settings.read"
	| "site_settings.update"
	| "comments.read"
	| "comments.moderate"
	| "comments.reply"
	| "comments.trash"
	| "comments.delete"
	| "comments.refresh_metadata"
	| "pages.read"
	| "pages.update"
	| "pages.trash"
	| "pages.delete"
	| "pages.trash_empty"
	| "page_registry.read"
	| "page_registry.update"
	| "commenters.read"
	| "visitors.read"
	| "blacklist.read"
	| "blacklist.create"
	| "blacklist.delete"
	| "allowlist.read"
	| "allowlist.create"
	| "allowlist.update"
	| "allowlist.delete"
	| "data.export"
	| "data.import"
	| "data.import_apply"
	| "wordpress_migration.analyze"
	| "wordpress_migration.plan"
	| "wordpress_migration.apply"
	| "tasks.read"
	| "tasks.schedule.create"
	| "tasks.schedule.update"
	| "tasks.schedule.delete"
	| "tasks.run"
	| "tasks.cancel"
	| "ops.read"
	| "ops.backup"
	| "ops.restore"
	| "ops.upgrade"
	| "ops.update_check"
	| "ops.service_control"
	| "ip_region_settings.update"
	| "users.read"
	| "users.create"
	| "users.update"
	| "users.delete"
	| "users.reset_password"
	| "groups.read";

export const systemGroups: Array<{
	key: AdminGroupKey;
	name: string;
	description: string;
}> = [
	{
		key: "admin",
		name: "管理员",
		description: "QingYan 实例级管理员。",
	},
	{
		key: "site_admin",
		name: "站点管理员",
		description: "管理授权站点的设置、评论、页面、访客和黑名单。",
	},
	{
		key: "site_moderator",
		name: "站点评论管理员",
		description: "处理授权站点的评论、评论者、访客和黑名单创建。",
	},
];

export const allAdminPermissions: AdminPermission[] = [
	"system_settings.read",
	"system_settings.update",
	"sites.read",
	"sites.create",
	"sites.update",
	"sites.delete",
	"site_settings.read",
	"site_settings.update",
	"comments.read",
	"comments.moderate",
	"comments.reply",
	"comments.trash",
	"comments.delete",
	"comments.refresh_metadata",
	"pages.read",
	"pages.update",
	"pages.trash",
	"pages.delete",
	"pages.trash_empty",
	"page_registry.read",
	"page_registry.update",
	"commenters.read",
	"visitors.read",
	"blacklist.read",
	"blacklist.create",
	"blacklist.delete",
	"allowlist.read",
	"allowlist.create",
	"allowlist.update",
	"allowlist.delete",
	"data.export",
	"data.import",
	"data.import_apply",
	"wordpress_migration.analyze",
	"wordpress_migration.plan",
	"wordpress_migration.apply",
	"tasks.read",
	"tasks.schedule.create",
	"tasks.schedule.update",
	"tasks.schedule.delete",
	"tasks.run",
	"tasks.cancel",
	"ops.read",
	"ops.backup",
	"ops.restore",
	"ops.upgrade",
	"ops.update_check",
	"ops.service_control",
	"ip_region_settings.update",
	"users.read",
	"users.create",
	"users.update",
	"users.delete",
	"users.reset_password",
	"groups.read",
];

const siteAdminPermissions: AdminPermission[] = [
	"sites.read",
	"site_settings.read",
	"site_settings.update",
	"comments.read",
	"comments.moderate",
	"comments.reply",
	"comments.trash",
	"comments.refresh_metadata",
	"pages.read",
	"pages.update",
	"pages.trash",
	"pages.delete",
	"pages.trash_empty",
	"page_registry.read",
	"page_registry.update",
	"commenters.read",
	"visitors.read",
	"blacklist.read",
	"blacklist.create",
	"blacklist.delete",
	"allowlist.read",
	"allowlist.create",
	"allowlist.update",
	"allowlist.delete",
];

const siteModeratorPermissions: AdminPermission[] = [
	"comments.read",
	"comments.moderate",
	"comments.reply",
	"comments.trash",
	"comments.refresh_metadata",
	"commenters.read",
	"visitors.read",
	"blacklist.read",
	"blacklist.create",
];

export function permissionsForGroup(
	groupKey: AdminGroupKey,
): AdminPermission[] {
	if (groupKey === "admin") {
		return allAdminPermissions;
	}
	if (groupKey === "site_admin") {
		return siteAdminPermissions;
	}
	if (groupKey === "system_builtin") {
		return [];
	}
	return siteModeratorPermissions;
}

export function isAdminGroupKey(value: string): value is AdminGroupKey {
	return (
		value === "admin" ||
		value === "site_admin" ||
		value === "site_moderator" ||
		value === "system_builtin"
	);
}
