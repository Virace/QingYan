import {
	and,
	count,
	eq,
	gt,
	inArray,
	isNull,
	like,
	ne,
	or,
	sql,
} from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	adminGroups,
	adminSessions,
	adminUserGroups,
	adminUsers,
	adminUserSiteAccess,
	adminProfileVerificationTokens,
	sites,
} from "../../db/schema";
import type { AdminGroupKey } from "./permissions";

export class AdminUsersRepository {
	public constructor(private readonly db: AppDatabase) {}

	public async getGroupByKey(key: AdminGroupKey) {
		const [group] = await this.db
			.select()
			.from(adminGroups)
			.where(eq(adminGroups.key, key))
			.limit(1);
		return group;
	}

	public async upsertSystemGroup(input: {
		key: AdminGroupKey;
		name: string;
		description: string;
	}) {
		const existing = await this.getGroupByKey(input.key);
		if (existing) {
			await this.db
				.update(adminGroups)
				.set({
					name: input.name,
					description: input.description,
					updatedAt: new Date().toISOString(),
				})
				.where(eq(adminGroups.id, existing.id));
			return this.getGroupByKey(input.key);
		}

		await this.db.insert(adminGroups).values({
			key: input.key,
			name: input.name,
			description: input.description,
			kind: "system",
		});
		return this.getGroupByKey(input.key);
	}

	public async getUserByUsername(username: string) {
		const [user] = await this.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, username))
			.limit(1);
		return user;
	}

	public async getUserByEmail(email: string) {
		const [user] = await this.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.email, email))
			.limit(1);
		return user;
	}

	public async getUserById(userId: number) {
		const [user] = await this.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.id, userId))
			.limit(1);
		return user;
	}

	public async listUsers(input: {
		siteKey?: string;
		search?: string;
		limit: number;
		offset: number;
	}) {
		const searchFilter = input.search
			? or(
					like(adminUsers.username, `%${input.search}%`),
					like(adminUsers.email, `%${input.search}%`),
					like(adminUsers.displayName, `%${input.search}%`),
				)
			: undefined;
		const siteFilter = input.siteKey
			? or(
					eq(adminGroups.key, "admin"),
					sql`exists (
						select 1
						from ${adminUserSiteAccess}
						inner join ${sites} on ${sites.id} = ${adminUserSiteAccess.siteId}
						where ${adminUserSiteAccess.userId} = ${adminUsers.id}
							and ${sites.siteKey} = ${input.siteKey}
					)`,
				)
			: undefined;
		const where =
			searchFilter && siteFilter
				? and(searchFilter, siteFilter)
				: (searchFilter ?? siteFilter);
		return this.db
			.select({
				id: adminUsers.id,
				username: adminUsers.username,
				email: adminUsers.email,
				displayName: adminUsers.displayName,
				website: adminUsers.website,
				avatarUrl: adminUsers.avatarUrl,
				status: adminUsers.status,
				isInitialAdmin: adminUsers.isInitialAdmin,
				passwordChangeRequired: adminUsers.passwordChangeRequired,
				loginBlockedUntil: adminUsers.loginBlockedUntil,
				createdAt: adminUsers.createdAt,
				updatedAt: adminUsers.updatedAt,
				passwordRotatedAt: adminUsers.passwordRotatedAt,
				lastLoginAt: adminUsers.lastLoginAt,
				deletedAt: adminUsers.deletedAt,
				groupId: adminGroups.id,
				groupKey: adminGroups.key,
				groupName: adminGroups.name,
			})
			.from(adminUsers)
			.innerJoin(adminUserGroups, eq(adminUserGroups.userId, adminUsers.id))
			.innerJoin(adminGroups, eq(adminGroups.id, adminUserGroups.groupId))
			.where(where)
			.limit(input.limit)
			.offset(input.offset);
	}

	public async listGroups() {
		return this.db.select().from(adminGroups);
	}

	public async createUser(input: {
		username: string;
		email: string;
		passwordHash: string;
		displayName: string;
		status?: "active" | "disabled" | "deleted";
		passwordChangeRequired?: boolean;
		isInitialAdmin?: boolean;
	}) {
		await this.db.insert(adminUsers).values({
			username: input.username,
			email: input.email,
			passwordHash: input.passwordHash,
			displayName: input.displayName,
			status: input.status ?? "active",
			isInitialAdmin: input.isInitialAdmin ?? false,
			passwordChangeRequired: input.passwordChangeRequired ?? false,
			passwordRotatedAt: new Date().toISOString(),
		});
		return this.getUserByUsername(input.username);
	}

	public async updateUser(input: {
		userId: number;
		email?: string;
		displayName?: string;
		website?: string | null;
		avatarUrl?: string | null;
		status?: "active" | "disabled" | "deleted";
		passwordChangeRequired?: boolean;
		loginBlockedUntil?: string | null;
	}) {
		await this.db
			.update(adminUsers)
			.set({
				email: input.email,
				displayName: input.displayName,
				website: input.website,
				avatarUrl: input.avatarUrl,
				status: input.status,
				passwordChangeRequired: input.passwordChangeRequired,
				loginBlockedUntil: input.loginBlockedUntil,
				deletedAt:
					input.status === "deleted" ? new Date().toISOString() : undefined,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(adminUsers.id, input.userId));
		return this.getUserById(input.userId);
	}

	public async updateUserPassword(input: {
		userId: number;
		passwordHash: string;
		passwordChangeRequired: boolean;
	}) {
		await this.db
			.update(adminUsers)
			.set({
				passwordHash: input.passwordHash,
				passwordChangeRequired: input.passwordChangeRequired,
				passwordRotatedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(adminUsers.id, input.userId));
		return this.getUserById(input.userId);
	}

	public async updateLastLogin(userId: number) {
		await this.db
			.update(adminUsers)
			.set({
				lastLoginAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(adminUsers.id, userId));
	}

	public async createInitialAdmin(input: {
		username: string;
		email: string;
		passwordHash: string;
		displayName: string;
	}) {
		await this.db.insert(adminUsers).values({
			username: input.username,
			email: input.email,
			passwordHash: input.passwordHash,
			displayName: input.displayName,
			status: "active",
			isInitialAdmin: true,
			passwordChangeRequired: false,
		});
		return this.getUserByUsername(input.username);
	}

	public async updateInitialAdmin(input: {
		userId: number;
		email: string;
		passwordHash: string;
		displayName: string;
	}) {
		await this.db
			.update(adminUsers)
			.set({
				email: input.email,
				passwordHash: input.passwordHash,
				displayName: input.displayName,
				status: "active",
				isInitialAdmin: true,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(adminUsers.id, input.userId));
		return this.getUserById(input.userId);
	}

	public async setUserGroup(input: { userId: number; groupId: number }) {
		const [existing] = await this.db
			.select()
			.from(adminUserGroups)
			.where(eq(adminUserGroups.userId, input.userId))
			.limit(1);
		if (existing) {
			await this.db
				.update(adminUserGroups)
				.set({
					groupId: input.groupId,
				})
				.where(eq(adminUserGroups.userId, input.userId));
			return;
		}

		await this.db.insert(adminUserGroups).values(input);
	}

	public async replaceUserSiteAccess(input: {
		userId: number;
		siteIds: number[];
		createdByUserId?: number;
	}) {
		await this.db
			.delete(adminUserSiteAccess)
			.where(eq(adminUserSiteAccess.userId, input.userId));
		if (input.siteIds.length === 0) {
			return;
		}
		await this.db.insert(adminUserSiteAccess).values(
			input.siteIds.map((siteId) => ({
				userId: input.userId,
				siteId,
				createdByUserId: input.createdByUserId,
			})),
		);
	}

	public async listUserSiteKeys(userId: number) {
		const rows = await this.db
			.select({
				siteKey: sites.siteKey,
			})
			.from(adminUserSiteAccess)
			.innerJoin(sites, eq(sites.id, adminUserSiteAccess.siteId))
			.where(eq(adminUserSiteAccess.userId, userId));
		return rows.map((row) => row.siteKey);
	}

	public async listSiteIdsByKeys(siteKeys: string[]) {
		if (siteKeys.length === 0) {
			return [];
		}
		return this.db
			.select({
				id: sites.id,
				siteKey: sites.siteKey,
			})
			.from(sites)
			.where(inArray(sites.siteKey, siteKeys));
	}

	public async getUserGroup(userId: number) {
		const [row] = await this.db
			.select({
				id: adminGroups.id,
				key: adminGroups.key,
				name: adminGroups.name,
				description: adminGroups.description,
				kind: adminGroups.kind,
			})
			.from(adminUserGroups)
			.innerJoin(adminGroups, eq(adminGroups.id, adminUserGroups.groupId))
			.where(eq(adminUserGroups.userId, userId))
			.limit(1);
		return row;
	}

	public async countActiveAdminsExcluding(userId: number) {
		const [row] = await this.db
			.select({ value: count() })
			.from(adminUsers)
			.innerJoin(adminUserGroups, eq(adminUserGroups.userId, adminUsers.id))
			.innerJoin(adminGroups, eq(adminGroups.id, adminUserGroups.groupId))
			.where(
				and(
					ne(adminUsers.id, userId),
					eq(adminUsers.status, "active"),
					eq(adminGroups.key, "admin"),
				),
			);
		return Number(row?.value ?? 0);
	}

	public async listUserSiteIds(userId: number) {
		const rows = await this.db
			.select({
				siteId: adminUserSiteAccess.siteId,
			})
			.from(adminUserSiteAccess)
			.where(eq(adminUserSiteAccess.userId, userId));
		return rows.map((row) => row.siteId);
	}

	public async listGrantedSites(userId: number) {
		return this.db
			.select()
			.from(sites)
			.innerJoin(adminUserSiteAccess, eq(adminUserSiteAccess.siteId, sites.id))
			.where(eq(adminUserSiteAccess.userId, userId));
	}

	public async getSiteByKey(siteKey: string) {
		const [site] = await this.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, siteKey))
			.limit(1);
		return site;
	}

	public async userHasSiteAccess(input: { userId: number; siteId: number }) {
		const [row] = await this.db
			.select()
			.from(adminUserSiteAccess)
			.where(
				and(
					eq(adminUserSiteAccess.userId, input.userId),
					eq(adminUserSiteAccess.siteId, input.siteId),
				),
			)
			.limit(1);
		return Boolean(row);
	}

	public async listSessionsByIds(sessionIds: string[]) {
		if (sessionIds.length === 0) {
			return [];
		}

		return this.db
			.select()
			.from(adminSessions)
			.where(inArray(adminSessions.id, sessionIds));
	}

	public async listActiveSessionStats(userIds: number[], nowIso: string) {
		if (userIds.length === 0) {
			return new Map<
				number,
				{ activeSessionCount: number; lastSessionSeenAt: string | null }
			>();
		}

		const rows = await this.db
			.select({
				userId: adminSessions.userId,
				activeSessionCount: count(),
				lastSessionSeenAt: sql<string | null>`MAX(${adminSessions.lastSeenAt})`,
			})
			.from(adminSessions)
			.where(
				and(
					inArray(adminSessions.userId, userIds),
					isNull(adminSessions.revokedAt),
					gt(adminSessions.expiresAt, nowIso),
				),
			)
			.groupBy(adminSessions.userId);

		const stats = new Map<
			number,
			{ activeSessionCount: number; lastSessionSeenAt: string | null }
		>();
		for (const row of rows) {
			if (row.userId === null) {
				continue;
			}
			stats.set(row.userId, {
				activeSessionCount: Number(row.activeSessionCount ?? 0),
				lastSessionSeenAt: row.lastSessionSeenAt ?? null,
			});
		}

		return stats;
	}

	public async deleteSessionsForUser(userId: number) {
		const rows = await this.db
			.select({ id: adminSessions.id })
			.from(adminSessions)
			.where(eq(adminSessions.userId, userId));
		await this.db.delete(adminSessions).where(eq(adminSessions.userId, userId));
		return rows.length;
	}

	public async revokeSessionsForUser(input: {
		userId: number;
		revokedByUserId: number;
		reason: string;
	}) {
		const now = new Date().toISOString();
		const rows = await this.db
			.select({ id: adminSessions.id })
			.from(adminSessions)
			.where(eq(adminSessions.userId, input.userId));
		await this.db
			.update(adminSessions)
			.set({
				revokedAt: now,
				revokedByUserId: input.revokedByUserId,
				revocationReason: input.reason,
			})
			.where(eq(adminSessions.userId, input.userId));
		return rows.length;
	}

	public async revokeSession(input: {
		sessionId: string;
		revokedByUserId: number;
		reason: string;
	}) {
		const now = new Date().toISOString();
		await this.db
			.update(adminSessions)
			.set({
				revokedAt: now,
				revokedByUserId: input.revokedByUserId,
				revocationReason: input.reason,
			})
			.where(eq(adminSessions.id, input.sessionId));
	}

	public async createProfileVerificationToken(input: {
		purpose: "email_change" | "password_change";
		userId: number;
		newEmail?: string | null;
		pendingPasswordHash?: string | null;
		tokenHash: string;
		expiresAt: string;
	}) {
		await this.db.insert(adminProfileVerificationTokens).values(input);
		const [token] = await this.db
			.select()
			.from(adminProfileVerificationTokens)
			.where(eq(adminProfileVerificationTokens.tokenHash, input.tokenHash))
			.limit(1);
		return token;
	}

	public async getProfileVerificationTokenByHash(tokenHash: string) {
		const [token] = await this.db
			.select()
			.from(adminProfileVerificationTokens)
			.where(eq(adminProfileVerificationTokens.tokenHash, tokenHash))
			.limit(1);
		return token;
	}

	public async consumeProfileVerificationToken(tokenId: number) {
		await this.db
			.update(adminProfileVerificationTokens)
			.set({
				consumedAt: new Date().toISOString(),
			})
			.where(eq(adminProfileVerificationTokens.id, tokenId));
	}
}
