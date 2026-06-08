import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { sites } from "./sites";

export const adminUsers = sqliteTable(
	"admin_users",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		username: text("username").notNull(),
		email: text("email").notNull(),
		passwordHash: text("password_hash").notNull(),
		displayName: text("display_name").notNull(),
		website: text("website"),
		avatarUrl: text("avatar_url"),
		status: text("status").notNull().default("active"),
		isInitialAdmin: integer("is_initial_admin", { mode: "boolean" })
			.notNull()
			.default(false),
		passwordChangeRequired: integer("password_change_required", {
			mode: "boolean",
		})
			.notNull()
			.default(false),
		loginBlockedUntil: text("login_blocked_until"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		passwordRotatedAt: text("password_rotated_at"),
		lastLoginAt: text("last_login_at"),
		deletedAt: text("deleted_at"),
	},
	(table) => [
		uniqueIndex("admin_users_username_idx").on(table.username),
		uniqueIndex("admin_users_email_idx").on(table.email),
		index("admin_users_status_idx").on(table.status),
	],
);

export const adminGroups = sqliteTable(
	"admin_groups",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		key: text("key").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		kind: text("kind").notNull().default("system"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex("admin_groups_key_idx").on(table.key)],
);

export const adminUserGroups = sqliteTable(
	"admin_user_groups",
	{
		userId: integer("user_id")
			.notNull()
			.references(() => adminUsers.id),
		groupId: integer("group_id")
			.notNull()
			.references(() => adminGroups.id),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		createdByUserId: integer("created_by_user_id").references(
			() => adminUsers.id,
		),
	},
	(table) => [
		uniqueIndex("admin_user_groups_user_idx").on(table.userId),
		index("admin_user_groups_group_idx").on(table.groupId),
	],
);

export const adminGroupPermissions = sqliteTable(
	"admin_group_permissions",
	{
		groupId: integer("group_id")
			.notNull()
			.references(() => adminGroups.id),
		permissionKey: text("permission_key").notNull(),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		createdByUserId: integer("created_by_user_id").references(
			() => adminUsers.id,
		),
	},
	(table) => [
		uniqueIndex("admin_group_permissions_group_permission_idx").on(
			table.groupId,
			table.permissionKey,
		),
	],
);

export const adminUserSiteAccess = sqliteTable(
	"admin_user_site_access",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: integer("user_id")
			.notNull()
			.references(() => adminUsers.id),
		siteId: integer("site_id")
			.notNull()
			.references(() => sites.id),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
		createdByUserId: integer("created_by_user_id").references(
			() => adminUsers.id,
		),
	},
	(table) => [
		uniqueIndex("admin_user_site_access_user_site_idx").on(
			table.userId,
			table.siteId,
		),
		index("admin_user_site_access_site_idx").on(table.siteId),
	],
);

export const adminProfileVerificationTokens = sqliteTable(
	"admin_profile_verification_tokens",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		purpose: text("purpose").notNull(),
		userId: integer("user_id")
			.notNull()
			.references(() => adminUsers.id),
		tokenHash: text("token_hash").notNull(),
		newEmail: text("new_email"),
		pendingPasswordHash: text("pending_password_hash"),
		expiresAt: text("expires_at").notNull(),
		consumedAt: text("consumed_at"),
		createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("admin_profile_verification_tokens_user_id_idx").on(table.userId),
		uniqueIndex("admin_profile_verification_tokens_token_hash_idx").on(
			table.tokenHash,
		),
	],
);
