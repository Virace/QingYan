import { createHash, randomUUID } from "node:crypto";

import type { AppDatabase } from "../../db/client";
import type { SecurityToolkit } from "../../plugins/security";
import { AppError } from "../shared/errors";
import { RuntimeSystemSettingsService } from "../system-settings/service";
import { AdminUsersRepository } from "./admin-users-repository";
import { createPasswordHash, verifyPasswordHash } from "./password-hash";
import type { AuthenticatedAdminSession } from "./session-service";

export class AdminProfileService {
	private readonly repository: AdminUsersRepository;

	public constructor(
		db: AppDatabase,
		private readonly security: SecurityToolkit,
		private readonly settings = new RuntimeSystemSettingsService(db),
	) {
		this.repository = new AdminUsersRepository(db);
	}

	private hashEmailVerificationToken(token: string) {
		return createHash("sha256").update(token).digest("hex");
	}

	private async requireUniqueEmail(email: string, currentUserId: number) {
		const existing = await this.repository.getUserByEmail(email);
		if (existing && existing.id !== currentUserId) {
			throw new AppError(
				409,
				"ADMIN_EMAIL_ALREADY_EXISTS",
				"该邮箱已被其他后台用户使用。",
			);
		}
	}

	private async requireCurrentPassword(
		userId: number,
		currentPassword?: string,
	) {
		const user = await this.repository.getUserById(userId);
		if (
			!user ||
			!currentPassword ||
			!verifyPasswordHash(currentPassword, user.passwordHash)
		) {
			throw new AppError(
				403,
				"ADMIN_CURRENT_PASSWORD_INVALID",
				"当前密码不正确。",
			);
		}
	}

	private async serializeProfile(session: AuthenticatedAdminSession) {
		const siteKeys =
			session.groupKey === "admin"
				? []
				: await this.repository.listUserSiteKeys(session.user.id);
		return {
			user: {
				id: session.user.id,
				username: session.user.username,
				email: session.user.email,
				displayName: session.user.displayName,
				website: session.user.website,
				avatarUrl: session.user.avatarUrl,
				groupKey: session.groupKey,
				groupName: session.groupName,
				isInitialAdmin: session.isInitialAdmin,
				passwordChangeRequired: session.user.passwordChangeRequired,
			},
			sites: siteKeys,
			session: {
				expiresAt: session.expiresAt,
			},
		};
	}

	public async getProfile(session: AuthenticatedAdminSession) {
		return this.serializeProfile(session);
	}

	public async updateProfile(input: {
		session: AuthenticatedAdminSession;
		displayName?: string;
		website?: string;
		avatarUrl?: string;
	}) {
		const patch = {
			displayName: input.displayName,
			website: input.website,
			avatarUrl: input.avatarUrl,
		};
		if (Object.values(patch).some((value) => value !== undefined)) {
			await this.repository.updateUser({
				userId: input.session.user.id,
				...patch,
			});
			await this.security.writeAudit({
				actorType: "admin_user",
				actorId: String(input.session.user.id),
				action: "admin.profile.updated",
				targetType: "admin_user",
				targetId: String(input.session.user.id),
				payload: {
					displayName: input.displayName,
					website: input.website,
					avatarUrl: input.avatarUrl,
				},
			});
		}
		const nextSession = {
			...input.session,
			user: {
				...input.session.user,
				displayName: input.displayName ?? input.session.user.displayName,
				website: input.website ?? input.session.user.website,
				avatarUrl: input.avatarUrl ?? input.session.user.avatarUrl,
			},
		};
		return this.serializeProfile(nextSession);
	}

	public async updatePassword(input: {
		session: AuthenticatedAdminSession;
		currentPassword: string;
		nextPassword: string;
	}) {
		const user = await this.repository.getUserById(input.session.user.id);
		if (
			!user ||
			!verifyPasswordHash(input.currentPassword, user.passwordHash)
		) {
			throw new AppError(
				403,
				"ADMIN_CURRENT_PASSWORD_INVALID",
				"当前密码不正确。",
			);
		}
		await this.repository.updateUserPassword({
			userId: input.session.user.id,
			passwordHash: createPasswordHash(input.nextPassword),
			passwordChangeRequired: false,
		});
		await this.security.writeAudit({
			actorType: "admin_user",
			actorId: String(input.session.user.id),
			action: "admin.profile.password_changed",
			targetType: "admin_user",
			targetId: String(input.session.user.id),
		});
		return this.serializeProfile({
			...input.session,
			user: {
				...input.session.user,
				passwordChangeRequired: false,
			},
		});
	}

	public async requestEmailChange(input: {
		session: AuthenticatedAdminSession;
		newEmail: string;
		currentPassword?: string;
	}) {
		const newEmail = input.newEmail.trim().toLowerCase();
		await this.requireUniqueEmail(newEmail, input.session.user.id);

		const adminSettings = await this.settings.getAdminSettings();
		if (
			adminSettings.emailVerification.selfServiceRequired &&
			input.session.groupKey !== "admin"
		) {
			const token = `ev_${randomUUID().replaceAll("-", "")}`;
			const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
			await this.repository.createEmailVerificationToken({
				userId: input.session.user.id,
				newEmail,
				tokenHash: this.hashEmailVerificationToken(token),
				expiresAt,
			});
			await this.security.writeAudit({
				actorType: "admin_user",
				actorId: String(input.session.user.id),
				action: "admin.profile.email_change_requested",
				targetType: "admin_user",
				targetId: String(input.session.user.id),
				payload: {
					newEmail,
					expiresAt,
				},
			});
			return {
				status: "pending_verification" as const,
				newEmail,
				expiresAt,
				verificationToken: token,
			};
		}

		await this.requireCurrentPassword(
			input.session.user.id,
			input.currentPassword,
		);
		const user = await this.repository.updateUser({
			userId: input.session.user.id,
			email: newEmail,
		});
		await this.repository.revokeSession({
			sessionId: input.session.id,
			revokedByUserId: input.session.user.id,
			reason: "profile_email_changed",
		});
		await this.security.writeAudit({
			actorType: "admin_user",
			actorId: String(input.session.user.id),
			action: "admin.profile.email_changed",
			targetType: "admin_user",
			targetId: String(input.session.user.id),
			payload: {
				newEmail,
				sessionRevoked: true,
			},
		});
		return {
			status: "changed" as const,
			user: {
				id: user?.id ?? input.session.user.id,
				username: user?.username ?? input.session.user.username,
				email: user?.email ?? newEmail,
				displayName: user?.displayName ?? input.session.user.displayName,
				groupKey: input.session.groupKey,
				groupName: input.session.groupName,
				isInitialAdmin: input.session.isInitialAdmin,
				passwordChangeRequired: user?.passwordChangeRequired ?? false,
			},
		};
	}

	public async confirmEmailChange(input: {
		session: AuthenticatedAdminSession;
		token: string;
	}) {
		const tokenHash = this.hashEmailVerificationToken(input.token);
		const token =
			await this.repository.getEmailVerificationTokenByHash(tokenHash);
		if (
			!token ||
			token.userId !== input.session.user.id ||
			token.consumedAt !== null
		) {
			throw new AppError(
				400,
				"ADMIN_EMAIL_VERIFICATION_TOKEN_INVALID",
				"邮箱验证令牌无效。",
			);
		}
		if (new Date(token.expiresAt).getTime() <= Date.now()) {
			throw new AppError(
				400,
				"ADMIN_EMAIL_VERIFICATION_TOKEN_EXPIRED",
				"邮箱验证令牌已过期。",
			);
		}
		await this.requireUniqueEmail(token.newEmail, input.session.user.id);
		await this.repository.updateUser({
			userId: input.session.user.id,
			email: token.newEmail,
		});
		await this.repository.consumeEmailVerificationToken(token.id);
		await this.security.writeAudit({
			actorType: "admin_user",
			actorId: String(input.session.user.id),
			action: "admin.profile.email_changed",
			targetType: "admin_user",
			targetId: String(input.session.user.id),
			payload: {
				newEmail: token.newEmail,
				verificationTokenId: token.id,
			},
		});
		return this.serializeProfile({
			...input.session,
			user: {
				...input.session.user,
				email: token.newEmail,
			},
		});
	}
}
