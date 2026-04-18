import type { AppConfig } from "../../config/types";
import type { SecurityToolkit } from "../../plugins/security";
import { AppError, ResourceNotFoundError } from "../shared/errors";
import { createCaptchaChallenge } from "../shared/captcha-challenge";
import type { CommentsRepository } from "./repository";
import type {
	CaptchaAction,
	CommentsWriteRepository,
} from "./write-repository";
import { requiresCaptchaForAttempt } from "./captcha-threshold";

interface CaptchaPayload {
	answer: string;
	imageData: string;
}

function resolveCaptchaPolicy(settings: {
	captchaMode: "never" | "always" | "threshold";
	captchaThresholdWindowSec: number;
	captchaThresholdMaxActions: number;
}) {
	return settings;
}

function getCaptchaRequiredCode(action: CaptchaAction): string {
	if (action === "comment_create") {
		return "COMMENT_CAPTCHA_REQUIRED";
	}
	if (action === "comment_vote") {
		return "VOTE_CAPTCHA_REQUIRED";
	}
	return "PAGE_FEEDBACK_CAPTCHA_REQUIRED";
}

function getCaptchaRateLimitCode(action: CaptchaAction): string {
	if (action === "comment_create") {
		return "COMMENT_RATE_LIMITED";
	}
	if (action === "comment_vote") {
		return "VOTE_RATE_LIMITED";
	}
	return "PAGE_FEEDBACK_RATE_LIMITED";
}

function resolveStateMode(
	activeSession?: {
		verified: boolean;
	},
	policyMode?: "never" | "always" | "threshold",
) {
	if (policyMode === "always") {
		return true;
	}

	if (policyMode === "threshold") {
		return Boolean(activeSession);
	}

	return false;
}

export class CaptchaService {
	public constructor(
		private readonly config: AppConfig,
		private readonly security: SecurityToolkit,
		private readonly commentsRepository: CommentsRepository,
		private readonly writeRepository: CommentsWriteRepository,
	) {}

	private async createChallengeSession(input: {
		siteId: number;
		visitorId: number;
		pageThreadId: number;
		triggeredBy: "always" | "threshold";
	}) {
		const challenge = createCaptchaChallenge();
		const challengeId = await this.writeRepository.createCaptchaSession({
			siteId: input.siteId,
			visitorId: input.visitorId,
			pageThreadId: input.pageThreadId,
			triggeredBy: input.triggeredBy,
			mode: "inline_value",
			challengePayloadJson: JSON.stringify({
				answer: challenge.answer,
				imageData: challenge.imageData,
			} satisfies CaptchaPayload),
			expiresAt: new Date(
				Date.now() + this.config.captcha.image.ttlSec * 1000,
			).toISOString(),
		});

		return {
			challengeId,
			imageData: challenge.imageData,
		};
	}

	public async getState(input: {
		siteKey: string;
		pageKey: string;
		pageTitle?: string;
		pageUrl?: string;
		requestId?: string;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
	}) {
		return this.readState({
			...input,
			refresh: false,
		});
	}

	public async refreshState(input: {
		siteKey: string;
		pageKey: string;
		pageTitle?: string;
		pageUrl?: string;
		requestId?: string;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
	}) {
		return this.readState({
			...input,
			refresh: true,
		});
	}

	private async readState(input: {
		siteKey: string;
		pageKey: string;
		pageTitle?: string;
		pageUrl?: string;
		requestId?: string;
		refresh: boolean;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
	}) {
		const site = this.commentsRepository.getRegisteredSite(input.siteKey);
		const configuredSite = this.commentsRepository.getConfiguredSite(
			input.siteKey,
		);
		if (!site || !configuredSite) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const settings = await this.commentsRepository.getRuntimeSettings(site.id);
		const policy = resolveCaptchaPolicy({
			captchaMode:
				(settings?.captchaMode as
					| "never"
					| "always"
					| "threshold"
					| undefined) ?? configuredSite.defaults.comments.captcha.mode,
			captchaThresholdWindowSec:
				settings?.captchaThresholdWindowSec ??
				configuredSite.defaults.comments.captcha.thresholdWindowSec,
			captchaThresholdMaxActions:
				settings?.captchaThresholdMaxActions ??
				configuredSite.defaults.comments.captcha.thresholdMaxActions,
		});

		const visitor = await this.commentsRepository.getOrCreateVisitor({
			siteId: site.id,
			visitorKey: input.visitorKey,
			ip: input.ip,
			userAgent: input.userAgent,
		});
		const thread = await this.commentsRepository.getOrCreatePageThread({
			siteId: site.id,
			pageKey: input.pageKey,
			pageTitle: input.pageTitle,
			pageUrl: input.pageUrl,
		});
		const activeSession = await this.writeRepository.getActiveCaptchaSession({
			siteId: site.id,
			visitorId: visitor.id,
			pageThreadId: thread.id,
		});
		const required = resolveStateMode(activeSession, policy.captchaMode);
		if (!required) {
			return {
				required: false,
				verified: false,
				mode: "inline_value" as const,
				challenge: null,
				visitorKey: visitor.created ? visitor.visitorKey : undefined,
			};
		}

		if (activeSession?.verified) {
			return {
				required: true,
				verified: true,
				mode: "inline_value" as const,
				challenge: null,
				visitorKey: visitor.created ? visitor.visitorKey : undefined,
			};
		}

		if (activeSession && input.refresh) {
			await this.writeRepository.expireCaptchaSession(activeSession.id);
		}

		if (activeSession?.challengePayloadJson && !input.refresh) {
			const payload = JSON.parse(
				activeSession.challengePayloadJson,
			) as CaptchaPayload;
			return {
				required: true,
				verified: false,
				mode: "inline_value" as const,
				challenge: {
					challengeId: activeSession.id,
					mode: "inline_value" as const,
					imageData: payload.imageData,
				},
				visitorKey: visitor.created ? visitor.visitorKey : undefined,
			};
		}

		const challenge = await this.createChallengeSession({
			siteId: site.id,
			visitorId: visitor.id,
			pageThreadId: thread.id,
			triggeredBy: policy.captchaMode === "always" ? "always" : "threshold",
		});
		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			actorType: "visitor",
			actorId: visitor.visitorKey,
			event: "captcha.required",
			message: "当前页面需要验证码",
			targetType: "page_thread",
			targetId: String(thread.id),
			payload: {
				triggeredBy: policy.captchaMode === "always" ? "always" : "threshold",
			},
		});

		return {
			required: true,
			verified: false,
			mode: "inline_value" as const,
			challenge: {
				challengeId: challenge.challengeId,
				mode: "inline_value" as const,
				imageData: challenge.imageData,
			},
			visitorKey: visitor.created ? visitor.visitorKey : undefined,
		};
	}

	public async markWriteAction(input: {
		siteKey: string;
		pageKey: string;
		pageTitle?: string;
		pageUrl?: string;
		action: CaptchaAction;
		requestId?: string;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
	}) {
		const site = this.commentsRepository.getRegisteredSite(input.siteKey);
		const configuredSite = this.commentsRepository.getConfiguredSite(
			input.siteKey,
		);
		if (!site || !configuredSite) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const settings = await this.commentsRepository.getRuntimeSettings(site.id);
		const policy = resolveCaptchaPolicy({
			captchaMode:
				(settings?.captchaMode as
					| "never"
					| "always"
					| "threshold"
					| undefined) ?? configuredSite.defaults.comments.captcha.mode,
			captchaThresholdWindowSec:
				settings?.captchaThresholdWindowSec ??
				configuredSite.defaults.comments.captcha.thresholdWindowSec,
			captchaThresholdMaxActions:
				settings?.captchaThresholdMaxActions ??
				configuredSite.defaults.comments.captcha.thresholdMaxActions,
		});
		if (policy.captchaMode !== "threshold") {
			return;
		}

		const visitor = await this.commentsRepository.getOrCreateVisitor({
			siteId: site.id,
			visitorKey: input.visitorKey,
			ip: input.ip,
			userAgent: input.userAgent,
		});
		const thread = await this.commentsRepository.getOrCreatePageThread({
			siteId: site.id,
			pageKey: input.pageKey,
			pageTitle: input.pageTitle,
			pageUrl: input.pageUrl,
		});
		const activeSession = await this.writeRepository.getActiveCaptchaSession({
			siteId: site.id,
			visitorId: visitor.id,
			pageThreadId: thread.id,
		});
		if (activeSession) {
			return;
		}

		const key = `captcha-threshold:${site.id}:${thread.id}:${visitor.visitorKey}`;
		const snapshot = this.security.peekRateLimit({
			key,
			rule: {
				windowSec: policy.captchaThresholdWindowSec,
				maxRequests: policy.captchaThresholdMaxActions,
			},
		});
		if (
			requiresCaptchaForAttempt(
				snapshot.count,
				policy.captchaThresholdMaxActions,
			)
		) {
			await this.createChallengeSession({
				siteId: site.id,
				visitorId: visitor.id,
				pageThreadId: thread.id,
				triggeredBy: "threshold",
			});
			await this.security.writeAudit({
				requestId: input.requestId,
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				actorType: "visitor",
				actorId: visitor.visitorKey,
				event: "captcha.required",
				message: "当前页面需要验证码",
				targetType: "page_thread",
				targetId: String(thread.id),
				payload: {
					triggeredBy: "threshold",
					action: input.action,
				},
			});
			throw new AppError(
				400,
				getCaptchaRequiredCode(input.action),
				"请先完成验证码验证。",
			);
		}

		await this.security.consumeRateLimit({
			key,
			rule: {
				windowSec: policy.captchaThresholdWindowSec,
				maxRequests: policy.captchaThresholdMaxActions,
			},
			errorCode: getCaptchaRateLimitCode(input.action),
			errorMessage: "请先完成验证码验证。",
		});
	}

	public async verify(input: {
		siteKey: string;
		pageKey: string;
		challengeId: string;
		mode: "inline_value";
		value: string;
		requestId?: string;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
		consumeRateLimit: (key: string) => Promise<void>;
		checkRateLimit: (key: string) => void;
	}) {
		const site = this.commentsRepository.getRegisteredSite(input.siteKey);
		const configuredSite = this.commentsRepository.getConfiguredSite(
			input.siteKey,
		);
		if (!site || !configuredSite) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const settings = await this.commentsRepository.getRuntimeSettings(site.id);
		const policy = resolveCaptchaPolicy({
			captchaMode:
				(settings?.captchaMode as
					| "never"
					| "always"
					| "threshold"
					| undefined) ?? configuredSite.defaults.comments.captcha.mode,
			captchaThresholdWindowSec:
				settings?.captchaThresholdWindowSec ??
				configuredSite.defaults.comments.captcha.thresholdWindowSec,
			captchaThresholdMaxActions:
				settings?.captchaThresholdMaxActions ??
				configuredSite.defaults.comments.captcha.thresholdMaxActions,
		});
		const required = policy.captchaMode !== "never";
		if (!required) {
			return {
				required: false,
				verified: true,
			};
		}

		const visitor = await this.commentsRepository.getOrCreateVisitor({
			siteId: site.id,
			visitorKey: input.visitorKey,
			ip: input.ip,
			userAgent: input.userAgent,
		});
		const thread = await this.commentsRepository.getOrCreatePageThread({
			siteId: site.id,
			pageKey: input.pageKey,
		});
		const activeSession = await this.writeRepository.getActiveCaptchaSession({
			siteId: site.id,
			visitorId: visitor.id,
			pageThreadId: thread.id,
		});
		if (!activeSession || activeSession.id !== input.challengeId) {
			throw new AppError(
				400,
				"COMMENT_CAPTCHA_REQUIRED",
				"请先完成验证码验证。",
			);
		}
		if (activeSession.verified) {
			return {
				required: true,
				verified: true,
			};
		}

		const identityKey = visitor.visitorKey || input.ip || "anonymous";
		input.checkRateLimit(identityKey);

		const payload = JSON.parse(
			activeSession.challengePayloadJson ?? "{}",
		) as CaptchaPayload;
		if (payload.answer !== input.value.trim()) {
			await this.security.writeAudit({
				requestId: input.requestId,
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				actorType: "visitor",
				actorId: visitor.visitorKey,
				event: "captcha.failed",
				level: "warn",
				message: "验证码校验失败",
				targetType: "page_thread",
				targetId: String(thread.id),
				payload: {
					challengeId: input.challengeId,
				},
			});
			await input.consumeRateLimit(identityKey);
			throw new AppError(400, "COMMENT_CAPTCHA_INVALID", "验证码错误。");
		}

		await this.writeRepository.markCaptchaVerified(activeSession.id);
		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			actorType: "visitor",
			actorId: visitor.visitorKey,
			event: "captcha.verified",
			message: "验证码校验通过",
			targetType: "page_thread",
			targetId: String(thread.id),
			payload: {
				challengeId: input.challengeId,
			},
		});
		return {
			required: true,
			verified: true,
		};
	}

	public async consumeInlineCaptcha(input: {
		siteKey: string;
		pageKey: string;
		challengeId: string;
		value: string;
		action: CaptchaAction;
		requestId?: string;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
	}) {
		const rule = this.config.security.rateLimit.captchaVerify;
		return this.verify({
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			challengeId: input.challengeId,
			mode: "inline_value",
			value: input.value,
			requestId: input.requestId,
			visitorKey: input.visitorKey,
			ip: input.ip,
			userAgent: input.userAgent,
			checkRateLimit: (identityKey) => {
				const snapshot = this.security.peekRateLimit({
					key: `public:${input.siteKey}:${identityKey}:captcha_verify`,
					rule,
				});
				if (snapshot.limit !== null && snapshot.count >= snapshot.limit) {
					throw new AppError(
						429,
						getCaptchaRateLimitCode(input.action),
						"请求过于频繁，请稍后再试。",
					);
				}
			},
			consumeRateLimit: async (identityKey) => {
				await this.security.consumeRateLimit({
					key: `public:${input.siteKey}:${identityKey}:captcha_verify`,
					rule,
					errorCode: getCaptchaRateLimitCode(input.action),
					errorMessage: "请求过于频繁，请稍后再试。",
				});
			},
		});
	}

	public async ensureSatisfied(input: {
		siteKey: string;
		pageKey: string;
		action: CaptchaAction;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
	}) {
		const site = this.commentsRepository.getRegisteredSite(input.siteKey);
		const configuredSite = this.commentsRepository.getConfiguredSite(
			input.siteKey,
		);
		if (!site || !configuredSite) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const settings = await this.commentsRepository.getRuntimeSettings(site.id);
		const policy = resolveCaptchaPolicy({
			captchaMode:
				(settings?.captchaMode as
					| "never"
					| "always"
					| "threshold"
					| undefined) ?? configuredSite.defaults.comments.captcha.mode,
			captchaThresholdWindowSec:
				settings?.captchaThresholdWindowSec ??
				configuredSite.defaults.comments.captcha.thresholdWindowSec,
			captchaThresholdMaxActions:
				settings?.captchaThresholdMaxActions ??
				configuredSite.defaults.comments.captcha.thresholdMaxActions,
		});
		if (policy.captchaMode === "never") {
			return;
		}

		const visitor = await this.commentsRepository.getOrCreateVisitor({
			siteId: site.id,
			visitorKey: input.visitorKey,
			ip: input.ip,
			userAgent: input.userAgent,
		});
		const thread = await this.commentsRepository.getOrCreatePageThread({
			siteId: site.id,
			pageKey: input.pageKey,
		});
		const activeSession = await this.writeRepository.getActiveCaptchaSession({
			siteId: site.id,
			visitorId: visitor.id,
			pageThreadId: thread.id,
		});
		if (policy.captchaMode === "threshold" && !activeSession) {
			return;
		}
		if (!activeSession?.verified) {
			throw new AppError(
				400,
				getCaptchaRequiredCode(input.action),
				"请先完成验证码验证。",
			);
		}
	}

	public getRateLimitCode(action: CaptchaAction): string {
		return getCaptchaRateLimitCode(action);
	}
}
