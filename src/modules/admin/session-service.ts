import type { FastifyRequest } from "fastify";

import type { AppConfig } from "../../config/types";
import type { SecurityToolkit } from "../../plugins/security";
import { AppError } from "../shared/errors";
import type { AdminRepository } from "./repository";
import {
	createSessionToken,
	hashSessionToken,
	verifyAdminToken,
} from "./session-utils";

export class AdminSessionService {
	public constructor(
		private readonly config: AppConfig,
		private readonly security: SecurityToolkit,
		private readonly repository: AdminRepository,
	) {}

	public getSessionCookieName() {
		return this.config.admin.session.cookieName;
	}

	public async login(input: {
		token: string;
		ip?: string;
		userAgent?: string;
	}) {
		if (input.ip) {
			await this.security.assertNotBlacklisted({
				ip: input.ip,
				errorCode: "ADMIN_BLACKLISTED",
				errorMessage: "当前来源已被禁止登录。",
			});

			const snapshot = this.security.peekRateLimit({
				key: `admin:global:${input.ip}:login`,
				rule: this.config.security.rateLimit.adminLogin,
			});
			if (snapshot.limit !== null && snapshot.count >= snapshot.limit) {
				throw new AppError(429, "ADMIN_RATE_LIMITED", "登录尝试过于频繁。");
			}
		}

		const isValid = verifyAdminToken(input.token, this.config.admin.tokenHash);
		if (!isValid) {
			await this.security.writeAudit({
				actorType: "admin",
				action: "admin.login.failure",
				payload: {
					ip: input.ip,
				},
			});

			if (input.ip) {
				const snapshot = await this.security.consumeRateLimit({
					key: `admin:global:${input.ip}:login`,
					rule: this.config.security.rateLimit.adminLogin,
					errorCode: "ADMIN_RATE_LIMITED",
					errorMessage: "登录尝试过于频繁。",
				});
				if (
					snapshot.limit !== null &&
					snapshot.count >= snapshot.limit &&
					this.config.security.rateLimit.adminLogin.autoBlacklistSec
				) {
					await this.repository.createBlacklistRule({
						scope: "all",
						targetType: "ip",
						matchMode: "exact",
						targetValue: input.ip,
						reason: "admin login rate limit",
						source: "auto",
						expiresAt: new Date(
							Date.now() +
								this.config.security.rateLimit.adminLogin.autoBlacklistSec *
									1000,
						).toISOString(),
					});
				}
			}

			throw new AppError(401, "ADMIN_TOKEN_INVALID", "管理员口令无效。");
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
