import { createHash } from "node:crypto";

import type { AppDatabase } from "../../db/client";
import type { EmailSender } from "../notifications/channels/email-channel";
import type { SecurityToolkit } from "../../plugins/security";
import { AppError } from "../shared/errors";
import { RuntimeSystemSettingsService } from "../system-settings/service";
import { AdminUsersRepository } from "./admin-users-repository";
import { createPasswordHash, verifyPasswordHash } from "./password-hash";
import type { AuthenticatedAdminSession } from "./session-service";

export type AdminProfileEmailSender = EmailSender;

export class AdminProfileService {
	private readonly repository: AdminUsersRepository;

	public constructor(
		db: AppDatabase,
		private readonly security: SecurityToolkit,
		private readonly settings = new RuntimeSystemSettingsService(db),
		private readonly emailSender?: EmailSender,
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

	private createEmailVerificationCode() {
		return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
	}

	private async canSendProfileVerificationEmail() {
		const settings = await this.settings.getSettings();
		return (
			settings.mail.enabled &&
			settings.admin.emailVerification.selfServiceRequired &&
			Boolean(settings.mail.smtp.host.trim()) &&
			Boolean(settings.mail.smtp.from.trim()) &&
			Boolean(this.emailSender)
		);
	}

	private async sendEmailChangeVerification(input: {
		to: string;
		from: string;
		code: string;
		expiresAt: string;
	}) {
		await this.emailSender?.({
			to: input.to,
			from: input.from,
			subject: "[QingYan] 后台邮箱变更验证码",
			body: [
				"你正在变更 QingYan 后台账号邮箱。",
				`验证码：${input.code}`,
				`有效期至：${input.expiresAt}`,
				"如果这不是你本人操作，请忽略本邮件并尽快修改密码。",
			].join("\n"),
			format: "text",
		});
	}

	private async sendPasswordChangeVerification(input: {
		to: string;
		from: string;
		code: string;
		expiresAt: string;
	}) {
		await this.emailSender?.({
			to: input.to,
			from: input.from,
			subject: "[QingYan] 后台密码变更验证码",
			body: [
				"你正在变更 QingYan 后台账号登录密码。",
				`验证码：${input.code}`,
				`有效期至：${input.expiresAt}`,
				"如果这不是你本人操作，请忽略本邮件并尽快检查账号安全。",
			].join("\n"),
			format: "text",
		});
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
		confirmPassword: string;
	}) {
		if (input.nextPassword !== input.confirmPassword) {
			throw new AppError(400, "INVALID_REQUEST", "两次输入的新密码不一致。");
		}
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
		const nextPasswordHash = createPasswordHash(input.nextPassword);
		const settings = await this.settings.getSettings();
		if (await this.canSendProfileVerificationEmail()) {
			const code = this.createEmailVerificationCode();
			const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
			await this.repository.createProfileVerificationToken({
				purpose: "password_change",
				userId: input.session.user.id,
				pendingPasswordHash: nextPasswordHash,
				tokenHash: this.hashEmailVerificationToken(code),
				expiresAt,
			});
			await this.sendPasswordChangeVerification({
				to: user.email,
				from: settings.mail.smtp.from,
				code,
				expiresAt,
			});
			await this.security.writeAudit({
				actorType: "admin_user",
				actorId: String(input.session.user.id),
				action: "admin.profile.password_change_requested",
				targetType: "admin_user",
				targetId: String(input.session.user.id),
				payload: {
					expiresAt,
				},
			});
			return {
				status: "pending_verification" as const,
				expiresAt,
			};
		}
		await this.repository.updateUserPassword({
			userId: input.session.user.id,
			passwordHash: nextPasswordHash,
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

	public async confirmPasswordChange(input: {
		session: AuthenticatedAdminSession;
		token: string;
	}) {
		const tokenHash = this.hashEmailVerificationToken(input.token);
		const token =
			await this.repository.getProfileVerificationTokenByHash(tokenHash);
		if (
			!token ||
			token.purpose !== "password_change" ||
			token.userId !== input.session.user.id ||
			token.consumedAt !== null ||
			!token.pendingPasswordHash
		) {
			throw new AppError(
				400,
				"ADMIN_PASSWORD_VERIFICATION_TOKEN_INVALID",
				"密码验证令牌无效。",
			);
		}
		if (new Date(token.expiresAt).getTime() <= Date.now()) {
			throw new AppError(
				400,
				"ADMIN_PASSWORD_VERIFICATION_TOKEN_EXPIRED",
				"密码验证令牌已过期。",
			);
		}
		await this.repository.updateUserPassword({
			userId: input.session.user.id,
			passwordHash: token.pendingPasswordHash,
			passwordChangeRequired: false,
		});
		await this.repository.consumeProfileVerificationToken(token.id);
		await this.security.writeAudit({
			actorType: "admin_user",
			actorId: String(input.session.user.id),
			action: "admin.profile.password_changed",
			targetType: "admin_user",
			targetId: String(input.session.user.id),
			payload: {
				verificationTokenId: token.id,
			},
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
		currentPassword: string;
	}) {
		const newEmail = input.newEmail.trim().toLowerCase();
		await this.requireCurrentPassword(
			input.session.user.id,
			input.currentPassword,
		);
		await this.requireUniqueEmail(newEmail, input.session.user.id);

		const settings = await this.settings.getSettings();
		if (await this.canSendProfileVerificationEmail()) {
			const code = this.createEmailVerificationCode();
			const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
			await this.repository.createProfileVerificationToken({
				purpose: "email_change",
				userId: input.session.user.id,
				newEmail,
				tokenHash: this.hashEmailVerificationToken(code),
				expiresAt,
			});
			await this.sendEmailChangeVerification({
				to: newEmail,
				from: settings.mail.smtp.from,
				code,
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
			};
		}

		const user = await this.repository.updateUser({
			userId: input.session.user.id,
			email: newEmail,
		});
		await this.security.writeAudit({
			actorType: "admin_user",
			actorId: String(input.session.user.id),
			action: "admin.profile.email_changed",
			targetType: "admin_user",
			targetId: String(input.session.user.id),
			payload: {
				newEmail,
				sessionRevoked: false,
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
			await this.repository.getProfileVerificationTokenByHash(tokenHash);
		if (
			!token ||
			token.purpose !== "email_change" ||
			token.userId !== input.session.user.id ||
			token.consumedAt !== null ||
			!token.newEmail
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
		await this.repository.consumeProfileVerificationToken(token.id);
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
