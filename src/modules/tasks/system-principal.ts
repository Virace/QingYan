import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { adminGroups, adminUserGroups, adminUsers } from "../../db/schema";

export const SYSTEM_BUILTIN_GROUP_KEY = "system_builtin";
export const PAGE_REGISTRY_SYSTEM_USERNAME = "system:page-registry";

const SYSTEM_LOGIN_BLOCKED_UNTIL = "9999-12-31T23:59:59.999Z";

export class SystemPrincipalService {
	public constructor(private readonly db: AppDatabase) {}

	public async ensurePageRegistryPrincipal() {
		const group = await this.ensureSystemGroup();
		const user = await this.ensureSystemUser();
		const [existingGroup] = await this.db
			.select()
			.from(adminUserGroups)
			.where(eq(adminUserGroups.userId, user.id))
			.limit(1);
		if (!existingGroup) {
			await this.db.insert(adminUserGroups).values({
				userId: user.id,
				groupId: group.id,
			});
		}
		return user;
	}

	private async ensureSystemGroup() {
		const [existing] = await this.db
			.select()
			.from(adminGroups)
			.where(eq(adminGroups.key, SYSTEM_BUILTIN_GROUP_KEY))
			.limit(1);
		if (existing) {
			await this.db
				.update(adminGroups)
				.set({
					name: "系统内置",
					description: "仅用于系统托管资源归类，不授予后台权限。",
					kind: "system",
					updatedAt: new Date().toISOString(),
				})
				.where(eq(adminGroups.id, existing.id));
			return { ...existing, name: "系统内置" };
		}
		await this.db.insert(adminGroups).values({
			key: SYSTEM_BUILTIN_GROUP_KEY,
			name: "系统内置",
			description: "仅用于系统托管资源归类，不授予后台权限。",
			kind: "system",
		});
		const [created] = await this.db
			.select()
			.from(adminGroups)
			.where(eq(adminGroups.key, SYSTEM_BUILTIN_GROUP_KEY))
			.limit(1);
		if (!created) {
			throw new Error("Failed to create system builtin group");
		}
		return created;
	}

	private async ensureSystemUser() {
		const [existing] = await this.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, PAGE_REGISTRY_SYSTEM_USERNAME))
			.limit(1);
		const timestamp = new Date().toISOString();
		if (existing) {
			await this.db
				.update(adminUsers)
				.set({
					email: "system-page-registry@localhost.invalid",
					displayName: "系统：页面注册表",
					status: "system",
					passwordChangeRequired: false,
					loginBlockedUntil: SYSTEM_LOGIN_BLOCKED_UNTIL,
					deletedAt: null,
					updatedAt: timestamp,
				})
				.where(eq(adminUsers.id, existing.id));
			const [updated] = await this.db
				.select()
				.from(adminUsers)
				.where(eq(adminUsers.id, existing.id))
				.limit(1);
			if (!updated) {
				throw new Error("Failed to update page registry system principal");
			}
			return updated;
		}
		await this.db.insert(adminUsers).values({
			username: PAGE_REGISTRY_SYSTEM_USERNAME,
			email: "system-page-registry@localhost.invalid",
			passwordHash: `system:${randomUUID()}`,
			displayName: "系统：页面注册表",
			status: "system",
			isInitialAdmin: false,
			passwordChangeRequired: false,
			loginBlockedUntil: SYSTEM_LOGIN_BLOCKED_UNTIL,
			createdAt: timestamp,
			updatedAt: timestamp,
		});
		const [created] = await this.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, PAGE_REGISTRY_SYSTEM_USERNAME))
			.limit(1);
		if (!created) {
			throw new Error("Failed to create page registry system principal");
		}
		return created;
	}
}
