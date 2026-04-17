import type { FastifyRequest } from "fastify";

import type { AppConfig } from "../../config/types";
import type { SecurityToolkit } from "../../plugins/security";
import { AppError } from "../shared/errors";
import type { AdminRepository } from "./repository";
import { AdminLoginChallengeStore } from "./login-challenge-store";
import {
	createSessionToken,
	hashSessionToken,
	verifyAdminToken,
} from "./session-utils";

const ADMIN_LOGIN_BLACKLIST_THRESHOLD = 5;

export class AdminSessionService {
	private readonly failedLoginCounts = new Map<string, number>();
	private readonly loginChallengeStore: AdminLoginChallengeStore;

	public constructor(
		private readonly config: AppConfig,
		private readonly security: SecurityToolkit,
		private readonly repository: AdminRepository,
	) {
		this.loginChallengeStore = new AdminLoginChallengeStore(
			this.config.captcha.image.ttlSec,
		);
	}

	public getSessionCookieName() {
		return this.config.admin.session.cookieName;
	}

	private async assertAdminLoginAllowed(ip?: string) {
		if (!ip) {
			return;
		}

		await this.security.assertNotBlacklisted({
			ip,
			errorCode: "ADMIN_BLACKLISTED",
			errorMessage: "当前来源已被永久禁止登录。",
		});
	}

	private async recordFailedLogin(input: {
		code: string;
		ip?: string;
		message: string;
		statusCode: number;
	}) {
		await this.security.writeAudit({
			actorType: "admin",
			action: "admin.login.failure",
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

		if (nextFailures >= ADMIN_LOGIN_BLACKLIST_THRESHOLD) {
			await this.repository.createBlacklistRule({
				scope: "all",
				targetType: "ip",
				matchMode: "exact",
				targetValue: input.ip,
				reason: "admin login failures",
				source: "auto",
			});
			this.failedLoginCounts.delete(input.ip);

			throw new AppError(
				403,
				"ADMIN_BLACKLISTED",
				"当前来源已被永久禁止登录。",
			);
		}

		throw new AppError(input.statusCode, input.code, input.message, {
			failureCount: nextFailures,
			maxFailures: ADMIN_LOGIN_BLACKLIST_THRESHOLD,
		});
	}

	public async createCaptcha(input: { ip?: string }) {
		await this.assertAdminLoginAllowed(input.ip);

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
		token: string;
		ip?: string;
		userAgent?: string;
	}) {
		await this.assertAdminLoginAllowed(input.ip);

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
				statusCode: 400,
			});
		}

		const isValid = verifyAdminToken(input.token, this.config.admin.tokenHash);
		if (!isValid) {
			await this.recordFailedLogin({
				code: "ADMIN_TOKEN_INVALID",
				ip: input.ip,
				message: "管理员口令无效。",
				statusCode: 401,
			});
		}

		if (input.ip) {
			this.failedLoginCounts.delete(input.ip);
		}

		const sessionToken = createSessionToken();
		const expiresAt = new Date(
			Date.now() + this.config.admin.session.ttlMinutes * 60 * 1000,
		).toISOString();
		await this.repository.createAdminSession({
			id: createSessionToken(),
			tokenHash: hashSessionToken(sessionToken),
			ip: input.ip,
			userAgent: input.userAgent,
			expiresAt,
		});

		await this.security.writeAudit({
			actorType: "admin",
			action: "admin.login.success",
			payload: {
				ip: input.ip,
			},
		});

		return {
			sessionToken,
			expiresAt,
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
		const sites = await this.repository.listSites();

		return {
			authenticated: true,
			session: {
				expiresAt: session.expiresAt,
			},
			sites: sites.map((site) => ({
				siteKey: site.siteKey,
				name: site.name,
			})),
		};
	}
}
