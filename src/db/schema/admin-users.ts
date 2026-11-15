import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	index,
	pgTable,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { exactText as text, utcTimestamp } from "./column-types";

import { sites } from "./sites";

export const adminUsers = pgTable(
	"admin_users",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		username: text("username").notNull(),
		email: text("email").notNull(),
		passwordHash: text("password_hash").notNull(),
		displayName: text("display_name").notNull(),
		website: text("website"),
		avatarUrl: text("avatar_url"),
		status: text("status").notNull().default("active"),
		isInitialAdmin: boolean("is_initial_admin").notNull().default(false),
		passwordChangeRequired: boolean("password_change_required")
			.notNull()
			.default(false),
		loginBlockedUntil: utcTimestamp("login_blocked_until"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		passwordRotatedAt: utcTimestamp("password_rotated_at"),
		lastLoginAt: utcTimestamp("last_login_at"),
		deletedAt: utcTimestamp("deleted_at"),
	},
	(table) => [
		uniqueIndex("admin_users_username_idx").on(table.username),
		uniqueIndex("admin_users_email_idx").on(table.email),
		index("admin_users_status_idx").on(table.status),
	],
);

export const adminGroups = pgTable(
	"admin_groups",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		key: text("key").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		kind: text("kind").notNull().default("system"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		updatedAt: utcTimestamp("updated_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex("admin_groups_key_idx").on(table.key)],
);

export const adminUserGroups = pgTable(
	"admin_user_groups",
	{
		userId: bigint("user_id", { mode: "number" })
			.primaryKey()
			.references(() => adminUsers.id),
		groupId: bigint("group_id", { mode: "number" })
			.notNull()
			.references(() => adminGroups.id),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		createdByUserId: bigint("created_by_user_id", {
			mode: "number",
		}).references(() => adminUsers.id),
	},
	(table) => [
		uniqueIndex("admin_user_groups_user_idx").on(table.userId),
		index("admin_user_groups_group_idx").on(table.groupId),
	],
);

export const adminUserSiteAccess = pgTable(
	"admin_user_site_access",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		userId: bigint("user_id", { mode: "number" })
			.notNull()
			.references(() => adminUsers.id),
		siteId: bigint("site_id", { mode: "number" })
			.notNull()
			.references(() => sites.id),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		createdByUserId: bigint("created_by_user_id", {
			mode: "number",
		}).references(() => adminUsers.id),
	},
	(table) => [
		uniqueIndex("admin_user_site_access_user_site_idx").on(
			table.userId,
			table.siteId,
		),
		index("admin_user_site_access_site_idx").on(table.siteId),
	],
);

export const adminProfileVerificationTokens = pgTable(
	"admin_profile_verification_tokens",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		purpose: text("purpose").notNull(),
		userId: bigint("user_id", { mode: "number" })
			.notNull()
			.references(() => adminUsers.id),
		tokenHash: text("token_hash").notNull(),
		newEmail: text("new_email"),
		pendingPasswordHash: text("pending_password_hash"),
		expiresAt: utcTimestamp("expires_at").notNull(),
		consumedAt: utcTimestamp("consumed_at"),
		createdAt: utcTimestamp("created_at")
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index("admin_profile_verification_tokens_user_id_idx").on(table.userId),
		uniqueIndex("admin_profile_verification_tokens_token_hash_idx").on(
			table.tokenHash,
		),
	],
);
