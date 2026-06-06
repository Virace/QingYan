import type { FastifyReply, FastifyRequest } from "fastify";

import type {
	AppRuntimeOptions,
	DevSiteSeed,
} from "../../config/runtime-options";
import { qingyanCookiePath } from "../../config/public-path";
import { createSessionToken } from "../admin/session-utils";
import { buildCommentForm } from "../comments/comment-form";
import { AppError, InvalidRequestError } from "../shared/errors";
import {
	buildDefaultSiteSettings,
	defaultCommentRequire,
} from "../shared/site-settings-defaults";

export class DevMemorySessionStore {
	private readonly sessions = new Map<string, { expiresAt: string }>();

	public constructor(private readonly runtimeOptions: AppRuntimeOptions) {}

	public getCookieName() {
		return "qingyan_admin";
	}

	public create(devToken: string) {
		if (devToken !== (this.runtimeOptions.devMode.adminToken ?? "")) {
			throw new AppError(401, "DEV_AUTH_REQUIRED", "开发模式认证失败。");
		}

		const sessionToken = createSessionToken();
		const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
		this.sessions.set(sessionToken, { expiresAt });
		return { sessionToken, expiresAt };
	}

	public require(request: FastifyRequest) {
		const sessionCookie = request.cookies[this.getCookieName()];
		const session = sessionCookie
			? this.sessions.get(sessionCookie)
			: undefined;
		if (!session) {
			throw new AppError(401, "ADMIN_AUTH_REQUIRED", "需要管理员登录。");
		}
		if (new Date(session.expiresAt).getTime() <= Date.now()) {
			this.sessions.delete(sessionCookie ?? "");
			throw new AppError(401, "ADMIN_SESSION_EXPIRED", "管理员会话已过期。");
		}
		return session;
	}

	public delete(request: FastifyRequest) {
		const sessionCookie = request.cookies[this.getCookieName()];
		if (sessionCookie) {
			this.sessions.delete(sessionCookie);
		}
	}
}

export function assertParsed<T>(parsed: {
	success: boolean;
	data?: T;
	error?: { issues: unknown[] };
}): T {
	if (!parsed.success) {
		throw new InvalidRequestError({
			issues: parsed.error?.issues ?? [],
		});
	}

	return parsed.data as T;
}

export function setVisitorCookie<T>(
	reply: FastifyReply,
	result: { body: T; visitorKey?: string },
) {
	if (result.visitorKey) {
		reply.setCookie("qingyan_visitor", result.visitorKey, {
			path: qingyanCookiePath(reply.server.config.server.publicPath),
			sameSite: "lax",
			httpOnly: true,
		});
	}

	return result.body;
}

export function buildSiteSummary(site: DevSiteSeed) {
	const settings = buildDefaultSiteSettings(0);
	return {
		siteKey: site.siteKey,
		name: site.name,
		allowedOrigins: site.allowedOrigins,
		comments: {
			enabled: settings.commentsEnabled,
			defaultStatus: settings.defaultStatus,
			identity: buildCommentForm({
				allowWebsite: settings.allowWebsite,
				commentRequireJson: JSON.stringify(defaultCommentRequire),
			}),
			allowWebsite: settings.allowWebsite,
			captcha: {
				mode: settings.captchaMode,
				thresholdWindowSec: settings.captchaThresholdWindowSec,
				thresholdMaxActions: settings.captchaThresholdMaxActions,
			},
		},
		pageFeedback: {
			allowLike: settings.allowPageLike,
		},
		notifications: {
			commenter: {
				replyEmailEnabled: settings.commenterReplyEmailEnabled,
			},
			backend: {
				enabled: settings.backendNotificationsEnabled,
			},
		},
		pageCount: 0,
		commentCount: 0,
		commenterCount: 0,
		visitorCount: 0,
	};
}
