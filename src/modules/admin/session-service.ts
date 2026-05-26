import type { FastifyRequest } from "fastify";

import type { AppConfig } from "../../config/types";
import type { SecurityToolkit } from "../../plugins/security";
import { AppError } from "../shared/errors";
import type { SiteRegistry } from "../shared/site-registry";
import { defaultSystemSettings } from "../system-settings/definitions";
import { RuntimeSystemSettingsService } from "../system-settings/service";
import type { AdminBootstrap } from "./bootstrap-service";
import { AdminLoginChallengeStore } from "./login-challenge-store";
import { verifyPasswordHash } from "./password-hash";
import type { AdminRepository } from "./repository";
import {
	createCsrfToken,
	createSessionToken,
	hashCsrfToken,
	hashSessionToken,
} from "./session-utils";

export class AdminSessionService {
	private readonly failedLoginCounts = new Map<string, number>();
	private readonly loginChallengeStore: AdminLoginChallengeStore;

	public constructor(
		private readonly config: AppConfig,
		private readonly security: SecurityToolkit,
		private readonly repository: AdminRepository,
		private readonly adminBootstrap: AdminBootstrap,
		private readonly siteRegistry?: SiteRegistry,
		private readonly systemSettings = new RuntimeSystemSettingsService(
			repository.database,
		),
	) {
		this.loginChallengeStore = new AdminLoginChallengeStore(
			defaultSystemSettings.captcha.image.ttlSec,
		);
	}

	public getSessionCookieName() {
		return this.config.admin.session.cookieName;
	}

	public async getSessionTtlMinutes() {
		return (await this.systemSettings.getAdminSessionSettings()).ttlMinutes;
	}

	private async issueCsrfToken(sessionId: string) {
		const csrfToken = createCsrfToken();
		const csrfIssuedAt = new Date().toISOString();
		await this.repository.updateAdminSessionCsrf({
			id: sessionId,
			csrfTokenHash: hashCsrfToken(csrfToken),
			csrfIssuedAt,
		});
		return {
			header: "x-qingyan-csrf-token" as const,
			token: csrfToken,
			issuedAt: csrfIssuedAt,
		};
	}

	public async createDevSession(input: {
		expectedToken: string;
		devToken: string;
		ip?: string;
		requestId?: string;
		userAgent?: string;
	}) {
		if (input.devToken !== input.expectedToken) {
			throw new AppError(401, "DEV_AUTH_REQUIRED", "开发模式认证失败。");
		}

		const sessionToken = createSessionToken();
		const sessionId = createSessionToken();
		const ttlMinutes = await this.getSessionTtlMinutes();
		const expiresAt = new Date(
			Date.now() + ttlMinutes * 60 * 1000,
		).toISOString();
		await this.repository.createAdminSession({
			id: sessionId,
			tokenHash: hashSessionToken(sessionToken),
			ip: input.ip,
			userAgent: input.userAgent,
			expiresAt,
		});
		const csrf = await this.issueCsrfToken(sessionId);

		await this.security.writeAudit({
			requestId: input.requestId,
			actorType: "admin",
			event: "admin.login.succeeded",
			message: "开发模式管理员会话已创建",
			targetType: "ip",
			targetId: input.ip,
			payload: {
				bootstrap: "dev",
				ip: input.ip,
			},
		});

		return {
			sessionToken,
			expiresAt,
			ttlMinutes,
			csrf,
		};
	}

	private async assertAdminLoginAllowed(input: {
		ip?: string;
		requestId?: string;
	}) {
		if (!input.ip) {
			return;
		}

		try {
			await this.security.assertNotBlacklisted({
				requestId: input.requestId,
				ip: input.ip,
				errorCode: "ADMIN_BLACKLISTED",
				errorMessage: "当前来源已被临时禁止登录。",
			});
		} catch (error) {
			await this.security.writeAudit({
				requestId: input.requestId,
				actorType: "admin",
				event: "admin.login.blocked",
				level: "warn",
				message: "管理员登录已被阻止",
				targetType: "ip",
				targetId: input.ip,
			});
			throw error;
		}
	}

	private async recordFailedLogin(input: {
		code: string;
		ip?: string;
		message: string;
		requestId?: string;
		statusCode: number;
	}) {
		await this.security.writeAudit({
			requestId: input.requestId,
			actorType: "admin",
			event: "admin.login.failed",
			level: "warn",
			message: "管理员登录失败",
			targetType: "ip",
			targetId: input.ip,
			payload: {
				ip: input.ip,
				code: input.code,
			},
		});

		if (!input.ip) {
			throw new AppError(input.statusCode, input.code, input.message);
		}

		const nextFailures = (this.failedLoginCounts.get(input.ip) ?? 0) + 1;
		this.failedLoginCounts.set(input.ip, nextFailures);
		const adminLoginRule = this.config.security.rateLimit.adminLogin;
		const maxFailures = adminLoginRule.maxFailures ?? 5;
		const autoBlacklistSec = adminLoginRule.autoBlacklistSec ?? 1800;

		if (nextFailures >= maxFailures) {
			const expiresAt = new Date(
				Date.now() + autoBlacklistSec * 1000,
			).toISOString();
			await this.repository.createBlacklistRule({
				scope: "all",
				targetType: "ip",
				matchMode: "exact",
				targetValue: input.ip,
				reason: "admin login failures",
				source: "auto",
				expiresAt,
			});
			await this.security.writeAudit({
				requestId: input.requestId,
				actorType: "system",
				event: "security.blacklist.added",
				level: "error",
				message: "已加入临时黑名单",
				targetType: "ip",
				targetId: input.ip,
				payload: {
					reason: "admin_login_failed_limit",
					ttlSec: autoBlacklistSec,
				},
			});
			this.failedLoginCounts.delete(input.ip);

			throw new AppError(
				403,
				"ADMIN_BLACKLISTED",
				"当前来源已被临时禁止登录。",
			);
		}

		throw new AppError(input.statusCode, input.code, input.message, {
			failureCount: nextFailures,
			maxFailures,
		});
	}

	public async createCaptcha(input: { ip?: string; requestId?: string }) {
		await this.assertAdminLoginAllowed(input);

		const challenge = this.loginChallengeStore.create(input.ip);
		return {
			challenge: {
				challengeId: challenge.challengeId,
				expiresAt: challenge.expiresAt,
				imageData: challenge.imageData,
				mode: "inline_value" as const,
			},
		};
	}

	public async login(input: {
		captchaValue?: string;
		challengeId?: string;
		username: string;
		password: string;
		ip?: string;
		requestId?: string;
		userAgent?: string;
	}) {
		await this.assertAdminLoginAllowed(input);

		const captchaState = this.loginChallengeStore.verify({
			challengeId: input.challengeId,
			ip: input.ip,
			value: input.captchaValue,
		});
		if (captchaState === "required") {
			throw new AppError(
				400,
				"ADMIN_CAPTCHA_REQUIRED",
				"请先完成管理员登录验证码验证。",
			);
		}
		if (captchaState === "invalid") {
			await this.recordFailedLogin({
				code: "ADMIN_CAPTCHA_INVALID",
				ip: input.ip,
				message: "管理员登录验证码错误。",
				requestId: input.requestId,
				statusCode: 400,
			});
		}

		const isValid =
			input.username === this.adminBootstrap.username &&
			verifyPasswordHash(input.password, this.adminBootstrap.passwordHash);
		if (!isValid) {
			await this.recordFailedLogin({
				code: "ADMIN_CREDENTIALS_INVALID",
				ip: input.ip,
				message: "管理员用户名或密码无效。",
				requestId: input.requestId,
				statusCode: 401,
			});
		}

		if (input.ip) {
			this.failedLoginCounts.delete(input.ip);
		}

		const sessionToken = createSessionToken();
		const sessionId = createSessionToken();
		const ttlMinutes = await this.getSessionTtlMinutes();
		const expiresAt = new Date(
			Date.now() + ttlMinutes * 60 * 1000,
		).toISOString();
		await this.repository.createAdminSession({
			id: sessionId,
			tokenHash: hashSessionToken(sessionToken),
			ip: input.ip,
			userAgent: input.userAgent,
			expiresAt,
		});
		const csrf = await this.issueCsrfToken(sessionId);

		await this.security.writeAudit({
			requestId: input.requestId,
			actorType: "admin",
			event: "admin.login.succeeded",
			message: "管理员登录成功",
			targetType: "ip",
			targetId: input.ip,
			payload: {
				ip: input.ip,
			},
		});

		return {
			sessionToken,
			expiresAt,
			ttlMinutes,
			csrf,
		};
	}

	public async requireSession(request: FastifyRequest) {
		const sessionCookie = request.cookies[this.getSessionCookieName()];
		if (!sessionCookie) {
			throw new AppError(401, "ADMIN_AUTH_REQUIRED", "需要管理员登录。");
		}

		const session = await this.repository.getAdminSessionByTokenHash(
			hashSessionToken(sessionCookie),
		);
		if (!session) {
			throw new AppError(401, "ADMIN_AUTH_REQUIRED", "需要管理员登录。");
		}
		if (new Date(session.expiresAt).getTime() <= Date.now()) {
			await this.repository.deleteAdminSession(session.id);
			await this.security.writeAudit({
				actorType: "admin",
				action: "admin.session.expired",
				payload: {
					sessionId: session.id,
				},
			});
			throw new AppError(401, "ADMIN_SESSION_EXPIRED", "管理员会话已过期。");
		}

		return session;
	}

	public async getOptionalSession(request: FastifyRequest) {
		try {
			return await this.requireSession(request);
		} catch (error) {
			if (error instanceof AppError) {
				return null;
			}
			throw error;
		}
	}

	public async logout(request: FastifyRequest) {
		const sessionCookie = request.cookies[this.getSessionCookieName()];
		if (!sessionCookie) {
			return;
		}

		const session = await this.repository.getAdminSessionByTokenHash(
			hashSessionToken(sessionCookie),
		);
		if (!session) {
			return;
		}

		await this.repository.deleteAdminSession(session.id);
		await this.security.writeAudit({
			actorType: "admin",
			action: "admin.logout",
		});
	}

	public async getMe(request: FastifyRequest) {
		const session = await this.requireSession(request);
		const csrf = await this.issueCsrfToken(session.id);
		await this.security.writeAudit({
			requestId: request.context?.requestId,
			actorType: "admin",
			event: "admin.csrf.rotated",
			level: "info",
			message: "后台 CSRF token 已轮换",
			targetType: "admin_request",
			targetId: request.url,
			payload: {
				path: request.url,
				method: request.method,
				issuedAt: csrf.issuedAt,
				hadExistingCsrf: Boolean(session.csrfTokenHash),
			},
		});
		const sites =
			this.siteRegistry?.listRegisteredSites() ??
			(await this.repository.listSites());

		return {
			authenticated: true,
			session: {
				expiresAt: session.expiresAt,
			},
			csrf: {
				header: csrf.header,
				token: csrf.token,
			},
			sites: sites.map((site) => ({
				siteKey: site.siteKey,
				name: site.name,
			})),
		};
	}
}
