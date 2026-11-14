import type { DatabaseExecutor } from "../../db/client";
import type { SecurityToolkit } from "../../plugins/security";
import { AppError, ResourceNotFoundError } from "../shared/errors";
import {
	permissionsForGroup,
	systemGroups,
	type AdminGroupKey,
} from "./permissions";
import type { AuthenticatedAdminSession } from "./session-service";
import { AdminUsersRepository } from "./admin-users-repository";
import { createPasswordHash } from "./password-hash";
import { requireCanTargetUser, requireInitialAdmin } from "./authorization";

export class AdminUsersService {
	private readonly repository: AdminUsersRepository;

	public constructor(
		private readonly db: DatabaseExecutor,
		private readonly security?: SecurityToolkit,
	) {
		this.repository = new AdminUsersRepository(db);
	}

	private async serializeUser(userId: number, repository = this.repository) {
		const user = await repository.getUserById(userId);
		if (!user) {
			throw new ResourceNotFoundError(
				"ADMIN_USER_NOT_FOUND",
				"后台用户不存在。",
			);
		}
		const group = await repository.getUserGroup(user.id);
		if (!group) {
			throw new AppError(
				500,
				"ADMIN_USER_GROUP_MISSING",
				"后台用户缺少用户组。",
			);
		}
		const siteKeys =
			group.key === "admin" ? [] : await repository.listUserSiteKeys(user.id);
		return {
			id: user.id,
			username: user.username,
			email: user.email,
			displayName: user.displayName,
			website: user.website,
			avatarUrl: user.avatarUrl,
			status: user.status,
			groupKey: group.key,
			groupName: group.name,
			siteKeys,
			isInitialAdmin: user.isInitialAdmin,
			passwordChangeRequired: user.passwordChangeRequired,
			loginBlockedUntil: user.loginBlockedUntil,
			lastLoginAt: user.lastLoginAt,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
			deletedAt: user.deletedAt,
		};
	}

	public async listUsers(input: {
		siteKey?: string;
		search?: string;
		limit: number;
		offset: number;
	}) {
		const rows = await this.repository.listUsers(input);
		const assignableGroupKeys = new Set(systemGroups.map((group) => group.key));
		const sessionStats = await this.repository.listActiveSessionStats(
			rows.map((row) => row.id),
			new Date().toISOString(),
		);
		const users = await Promise.all(
			rows.map(async (row) => {
				const user = await this.serializeUser(row.id);
				const stats = sessionStats.get(row.id) ?? {
					activeSessionCount: 0,
					lastSessionSeenAt: null,
				};
				return {
					...user,
					activeSessionCount: stats.activeSessionCount,
					lastSessionSeenAt: stats.lastSessionSeenAt,
				};
			}),
		);
		return {
			users: users.filter((user) =>
				assignableGroupKeys.has(user.groupKey as AdminGroupKey),
			),
		};
	}

	public async listGroups() {
		const assignableGroupKeys = new Set(systemGroups.map((group) => group.key));
		return {
			groups: (await this.repository.listGroups())
				.filter((group) => assignableGroupKeys.has(group.key as AdminGroupKey))
				.map((group) => ({
					id: group.id,
					key: group.key,
					name: group.name,
					description: group.description,
					kind: group.kind,
					permissions: permissionsForGroup(group.key as AdminGroupKey),
				})),
		};
	}

	private async assertGroupAssignable(
		input: {
			session: AuthenticatedAdminSession;
			groupKey: AdminGroupKey;
		},
		repository = this.repository,
	) {
		if (input.groupKey === "admin") {
			requireInitialAdmin(input.session);
		}
		const group = await repository.getGroupByKey(input.groupKey);
		if (!group) {
			throw new ResourceNotFoundError(
				"ADMIN_GROUP_NOT_FOUND",
				"用户组不存在。",
			);
		}
		return group;
	}

	private async resolveSiteIds(
		siteKeys: string[],
		repository = this.repository,
	) {
		const uniqueKeys = Array.from(new Set(siteKeys));
		const sites = await repository.listSiteIdsByKeys(uniqueKeys);
		if (sites.length !== uniqueKeys.length) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}
		return sites.map((site) => site.id);
	}

	private async writeUserAudit(input: {
		session: AuthenticatedAdminSession;
		action: string;
		target: Awaited<ReturnType<AdminUsersService["serializeUser"]>>;
		payload?: Record<string, unknown>;
	}) {
		await this.security?.writeAudit({
			actorType: "admin_user",
			actorId: String(input.session.user.id),
			action: input.action,
			targetType: "admin_user",
			targetId: String(input.target.id),
			payload: {
				actor: {
					username: input.session.user.username,
					displayName: input.session.user.displayName,
					groupKey: input.session.groupKey,
					siteIds: input.session.siteIds,
				},
				target: {
					username: input.target.username,
					displayName: input.target.displayName,
					groupKey: input.target.groupKey,
					status: input.target.status,
					isInitialAdmin: input.target.isInitialAdmin,
				},
				...input.payload,
			},
		});
	}

	private async assertCanMutateTarget(
		input: {
			session: AuthenticatedAdminSession;
			target: Awaited<ReturnType<AdminUsersService["serializeUser"]>>;
			nextGroupKey?: AdminGroupKey;
			nextStatus?: "active" | "disabled" | "deleted";
		},
		repository = this.repository,
	) {
		const protectsInitialAdmin =
			input.target.isInitialAdmin &&
			((input.nextStatus !== undefined && input.nextStatus !== "active") ||
				(input.nextGroupKey !== undefined && input.nextGroupKey !== "admin"));
		if (protectsInitialAdmin) {
			throw new AppError(
				403,
				"ADMIN_INITIAL_ADMIN_PROTECTED",
				"不能停用、删除或降级初始管理员。",
			);
		}
		requireCanTargetUser({
			session: input.session,
			target: {
				id: input.target.id,
				groupKey: input.target.groupKey,
				isInitialAdmin: input.target.isInitialAdmin,
			},
		});
		if (
			input.target.groupKey === "admin" &&
			input.target.status === "active" &&
			(input.nextStatus === "disabled" ||
				input.nextStatus === "deleted" ||
				(input.nextGroupKey !== undefined && input.nextGroupKey !== "admin"))
		) {
			const remainingAdmins = await repository.countActiveAdminsExcluding(
				input.target.id,
			);
			if (remainingAdmins === 0) {
				throw new AppError(
					403,
					"ADMIN_LAST_ACTIVE_ADMIN",
					"系统必须至少保留一个启用的管理员。",
				);
			}
		}
	}

	private resolveLoginBlockedUntil(input: {
		loginBlockPreset?: "none" | "1h" | "1d" | "7d" | "custom";
		loginBlockedUntil?: string;
	}) {
		const preset = input.loginBlockPreset ?? "none";
		if (preset === "none") {
			return null;
		}
		if (preset === "custom") {
			return input.loginBlockedUntil ?? null;
		}
		const durationsMs: Record<"1h" | "1d" | "7d", number> = {
			"1h": 60 * 60 * 1000,
			"1d": 24 * 60 * 60 * 1000,
			"7d": 7 * 24 * 60 * 60 * 1000,
		};
		return new Date(Date.now() + durationsMs[preset]).toISOString();
	}

	public async createUser(input: {
		session: AuthenticatedAdminSession;
		username: string;
		email: string;
		displayName: string;
		password: string;
		groupKey: AdminGroupKey;
		siteKeys: string[];
		passwordChangeRequired: boolean;
	}) {
		const passwordHash = createPasswordHash(input.password);
		const user = await this.db.transaction(async (tx) => {
			const repository = new AdminUsersRepository(tx);
			const group = await this.assertGroupAssignable(input, repository);
			const siteIds =
				input.groupKey === "admin"
					? []
					: await this.resolveSiteIds(input.siteKeys, repository);
			const createdUser = await repository.createUser({
				username: input.username,
				email: input.email,
				displayName: input.displayName,
				passwordHash,
				passwordChangeRequired: input.passwordChangeRequired,
			});
			if (!createdUser) {
				throw new AppError(
					500,
					"ADMIN_USER_CREATE_FAILED",
					"后台用户创建失败。",
				);
			}
			await repository.setUserGroup({
				userId: createdUser.id,
				groupId: group.id,
			});
			await repository.replaceUserSiteAccess({
				userId: createdUser.id,
				siteIds,
				createdByUserId: input.session.user.id,
			});
			return this.serializeUser(createdUser.id, repository);
		});
		await this.writeUserAudit({
			session: input.session,
			action: "admin.user.created",
			target: user,
		});
		return {
			user,
		};
	}

	public async updateUser(input: {
		session: AuthenticatedAdminSession;
		userId: number;
		email?: string;
		displayName?: string;
		groupKey?: AdminGroupKey;
		siteKeys?: string[];
		status?: "active" | "disabled" | "deleted";
		passwordChangeRequired?: boolean;
	}) {
		const { target, user, revokedSessions } = await this.db.transaction(
			async (tx) => {
				const repository = new AdminUsersRepository(tx);
				await repository.lockUser(input.userId);
				const target = await this.serializeUser(input.userId, repository);
				const nextGroupKey =
					input.groupKey ?? (target.groupKey as AdminGroupKey);
				await this.assertCanMutateTarget(
					{
						session: input.session,
						target,
						nextGroupKey,
						nextStatus: input.status,
					},
					repository,
				);
				const group = input.groupKey
					? await this.assertGroupAssignable(
							{
								session: input.session,
								groupKey: input.groupKey,
							},
							repository,
						)
					: undefined;
				const siteIds =
					input.siteKeys || input.groupKey
						? nextGroupKey === "admin"
							? []
							: await this.resolveSiteIds(
									input.siteKeys ?? target.siteKeys,
									repository,
								)
						: undefined;

				await repository.updateUser({
					userId: input.userId,
					email: input.email,
					displayName: input.displayName,
					status: input.status,
					passwordChangeRequired: input.passwordChangeRequired,
				});
				if (group) {
					await repository.setUserGroup({
						userId: input.userId,
						groupId: group.id,
					});
				}
				if (siteIds) {
					await repository.replaceUserSiteAccess({
						userId: input.userId,
						siteIds,
						createdByUserId: input.session.user.id,
					});
				}
				const revokedSessions =
					input.status === "disabled" || input.status === "deleted"
						? await repository.revokeSessionsForUser({
								userId: input.userId,
								revokedByUserId: input.session.user.id,
								reason: input.status,
							})
						: 0;
				return {
					target,
					user: await this.serializeUser(input.userId, repository),
					revokedSessions,
				};
			},
		);
		await this.writeUserAudit({
			session: input.session,
			action:
				input.status === "deleted"
					? "admin.user.deleted"
					: input.status === "disabled"
						? "admin.user.disabled"
						: "admin.user.updated",
			target,
			payload: {
				revokedSessions,
				affectedCount: revokedSessions,
				patch: {
					email: input.email,
					displayName: input.displayName,
					groupKey: input.groupKey,
					siteKeys: input.siteKeys,
					status: input.status,
					passwordChangeRequired: input.passwordChangeRequired,
				},
			},
		});
		return {
			user,
			revokedSessions,
		};
	}

	public async deleteUser(input: {
		session: AuthenticatedAdminSession;
		userId: number;
	}) {
		return this.updateUser({
			session: input.session,
			userId: input.userId,
			status: "deleted",
		});
	}

	public async revokeSessions(input: {
		session: AuthenticatedAdminSession;
		userId: number;
		loginBlockPreset?: "none" | "1h" | "1d" | "7d" | "custom";
		loginBlockedUntil?: string;
		reason?: string;
	}) {
		const loginBlockedUntil = this.resolveLoginBlockedUntil(input);
		const reason = input.reason ?? "forced_logout";
		const { target, user, revokedSessions } = await this.db.transaction(
			async (tx) => {
				const repository = new AdminUsersRepository(tx);
				await repository.lockUser(input.userId);
				const target = await this.serializeUser(input.userId, repository);
				await this.assertCanMutateTarget(
					{
						session: input.session,
						target,
					},
					repository,
				);
				await repository.updateUser({
					userId: input.userId,
					loginBlockedUntil,
				});
				const revokedSessions = await repository.revokeSessionsForUser({
					userId: input.userId,
					revokedByUserId: input.session.user.id,
					reason,
				});
				return {
					target,
					user: await this.serializeUser(input.userId, repository),
					revokedSessions,
				};
			},
		);
		await this.writeUserAudit({
			session: input.session,
			action: "admin.user.sessions_revoked",
			target,
			payload: {
				revokedSessions,
				affectedCount: revokedSessions,
				loginBlockedUntil,
				reason,
			},
		});
		return {
			user,
			revokedSessions,
		};
	}

	public async resetPassword(input: {
		session: AuthenticatedAdminSession;
		userId: number;
		password: string;
		passwordChangeRequired: boolean;
	}) {
		const passwordHash = createPasswordHash(input.password);
		const { target, user, revokedSessions } = await this.db.transaction(
			async (tx) => {
				const repository = new AdminUsersRepository(tx);
				await repository.lockUser(input.userId);
				const target = await this.serializeUser(input.userId, repository);
				await this.assertCanMutateTarget(
					{
						session: input.session,
						target,
					},
					repository,
				);
				await repository.updateUserPassword({
					userId: input.userId,
					passwordHash,
					passwordChangeRequired: input.passwordChangeRequired,
				});
				const revokedSessions = await repository.revokeSessionsForUser({
					userId: input.userId,
					revokedByUserId: input.session.user.id,
					reason: "password_reset",
				});
				return {
					target,
					user: await this.serializeUser(input.userId, repository),
					revokedSessions,
				};
			},
		);
		await this.writeUserAudit({
			session: input.session,
			action: "admin.user.password_reset",
			target,
			payload: {
				revokedSessions,
				affectedCount: revokedSessions,
				passwordChangeRequired: input.passwordChangeRequired,
			},
		});
		return {
			user,
			revokedSessions,
		};
	}
}

export function fixedSystemGroups() {
	return systemGroups;
}
