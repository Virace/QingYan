import type { AppConfig, SiteConfig } from "../../config/types";
import type { SecurityToolkit } from "../../plugins/security";
import { AppError, ResourceNotFoundError } from "../shared/errors";
import type { CommentsRepository } from "./repository";
import type {
	CaptchaAction,
	CommentsWriteRepository,
} from "./write-repository";
import {
	isInlineCaptchaSessionPayload,
	resolveCaptchaHostMode,
	type CaptchaSessionPayload,
	type PublicCaptchaProviderKind,
} from "./captcha-provider-types";
import { requiresCaptchaForAttempt } from "./captcha-threshold";
import {
	createImageCaptchaChallenge,
	verifyImageCaptchaValue,
} from "./providers/image-provider";
import {
	createTurnstileChallenge,
	renderTurnstileWidgetHtml,
	verifyTurnstileToken,
} from "./providers/turnstile-provider";
import {
	createHCaptchaChallenge,
	renderHCaptchaWidgetHtml,
	verifyHCaptchaToken,
} from "./providers/hcaptcha-provider";
import {
	createRecaptchaChallenge,
	renderRecaptchaWidgetHtml,
	verifyRecaptchaToken,
} from "./providers/recaptcha-provider";
import {
	createGeeTestChallenge,
	renderGeeTestWidgetHtml,
	verifyGeeTestToken,
} from "./providers/geetest-provider";

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

	private getCaptchaTtlSec() {
		return this.config.captcha.image.ttlSec;
	}

	private getCurrentProviderKind(): PublicCaptchaProviderKind {
		return this.config.captcha.provider;
	}

	private getCurrentHostMode() {
		return resolveCaptchaHostMode(this.getCurrentProviderKind());
	}

	private requireTurnstileConfig() {
		if (!this.config.captcha.turnstile) {
			throw new AppError(500, "CAPTCHA_CONFIG_INVALID", "验证码配置无效。");
		}
		return this.config.captcha.turnstile;
	}

	private requireHCaptchaConfig() {
		if (!this.config.captcha.hcaptcha) {
			throw new AppError(500, "CAPTCHA_CONFIG_INVALID", "验证码配置无效。");
		}
		return this.config.captcha.hcaptcha;
	}

	private requireRecaptchaConfig() {
		if (!this.config.captcha.recaptcha) {
			throw new AppError(500, "CAPTCHA_CONFIG_INVALID", "验证码配置无效。");
		}
		return this.config.captcha.recaptcha;
	}

	private requireGeeTestConfig() {
		if (!this.config.captcha.geetest) {
			throw new AppError(500, "CAPTCHA_CONFIG_INVALID", "验证码配置无效。");
		}
		return this.config.captcha.geetest;
	}

	private parseSessionPayload(session: {
		challengePayloadJson: string | null;
	}) {
		if (!session.challengePayloadJson) {
			throw new AppError(
				500,
				"CAPTCHA_SESSION_INVALID",
				"验证码会话数据损坏。",
			);
		}
		return JSON.parse(session.challengePayloadJson) as CaptchaSessionPayload;
	}

	private async resolvePolicy(input: {
		siteId: number;
		configuredSite: SiteConfig;
	}) {
		const settings = await this.commentsRepository.getRuntimeSettings(
			input.siteId,
		);
		return resolveCaptchaPolicy({
			captchaMode:
				(settings?.captchaMode as
					| "never"
					| "always"
					| "threshold"
					| undefined) ?? input.configuredSite.defaults.comments.captcha.mode,
			captchaThresholdWindowSec:
				settings?.captchaThresholdWindowSec ??
				input.configuredSite.defaults.comments.captcha.thresholdWindowSec,
			captchaThresholdMaxActions:
				settings?.captchaThresholdMaxActions ??
				input.configuredSite.defaults.comments.captcha.thresholdMaxActions,
		});
	}

	private buildIdleState(visitorKey?: string) {
		return {
			required: false,
			verified: false,
			mode: this.getCurrentHostMode(),
			challenge: null,
			visitorKey,
		};
	}

	private buildVerifiedState(input: {
		mode: "inline_value" | "iframe_widget";
		visitorKey?: string;
	}) {
		return {
			required: true,
			verified: true,
			mode: input.mode,
			challenge: null,
			visitorKey: input.visitorKey,
		};
	}

	private async createChallengeSession(input: {
		siteId: number;
		visitorId: number;
		pageThreadId: number;
		siteKey: string;
		pageKey: string;
		triggeredBy: "always" | "threshold";
	}) {
		const challengeId = this.writeRepository.createCaptchaSessionId();
		const expiresAt = new Date(
			Date.now() + this.getCaptchaTtlSec() * 1000,
		).toISOString();

		let created:
			| ReturnType<typeof createImageCaptchaChallenge>
			| ReturnType<typeof createTurnstileChallenge>
			| ReturnType<typeof createHCaptchaChallenge>
			| ReturnType<typeof createRecaptchaChallenge>
			| ReturnType<typeof createGeeTestChallenge>;

		switch (this.getCurrentProviderKind()) {
			case "image":
				created = createImageCaptchaChallenge({
					challengeId,
					ttlSec: this.getCaptchaTtlSec(),
				});
				break;
			case "turnstile":
				created = createTurnstileChallenge({
					challengeId,
					siteKey: input.siteKey,
					pageKey: input.pageKey,
				});
				break;
			case "hcaptcha":
				created = createHCaptchaChallenge({
					challengeId,
					siteKey: input.siteKey,
					pageKey: input.pageKey,
				});
				break;
			case "recaptcha":
				created = createRecaptchaChallenge({
					challengeId,
					siteKey: input.siteKey,
					pageKey: input.pageKey,
				});
				break;
			case "geetest":
				created = createGeeTestChallenge({
					challengeId,
					siteKey: input.siteKey,
					pageKey: input.pageKey,
				});
				break;
			default:
				throw new AppError(500, "CAPTCHA_CONFIG_INVALID", "验证码配置无效。");
		}

		await this.writeRepository.createCaptchaSession({
			id: challengeId,
			siteId: input.siteId,
			visitorId: input.visitorId,
			pageThreadId: input.pageThreadId,
			triggeredBy: input.triggeredBy,
			mode: created.mode,
			providerKind: created.providerKind,
			challengePayloadJson: created.challengePayloadJson,
			expiresAt:
				created.expiresAt && created.expiresAt.length > 0
					? created.expiresAt
					: expiresAt,
		});

		return created.publicChallenge;
	}

	private async resolveContext(input: {
		siteKey: string;
		pageKey: string;
		pageTitle?: string;
		pageUrl?: string;
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

		return {
			site,
			configuredSite,
			visitor,
			thread,
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
		const { site, configuredSite, visitor, thread } =
			await this.resolveContext(input);
		const policy = await this.resolvePolicy({
			siteId: site.id,
			configuredSite,
		});

		const activeSession = await this.writeRepository.getActiveCaptchaSession({
			siteId: site.id,
			visitorId: visitor.id,
			pageThreadId: thread.id,
		});
		const publicVisitorKey = visitor.created ? visitor.visitorKey : undefined;
		const required = resolveStateMode(activeSession, policy.captchaMode);
		if (!required) {
			return this.buildIdleState(publicVisitorKey);
		}

		const activeMode =
			(activeSession?.mode as "inline_value" | "iframe_widget" | undefined) ??
			this.getCurrentHostMode();
		if (activeSession?.verified) {
			return this.buildVerifiedState({
				mode: activeMode,
				visitorKey: publicVisitorKey,
			});
		}

		if (activeSession && input.refresh) {
			await this.writeRepository.expireCaptchaSession(activeSession.id);
		}

		if (activeSession?.challengePayloadJson && !input.refresh) {
			const payload = this.parseSessionPayload(activeSession);
			return {
				required: true,
				verified: false,
				mode: payload.publicChallenge.mode,
				challenge: payload.publicChallenge,
				visitorKey: publicVisitorKey,
			};
		}

		const challenge = await this.createChallengeSession({
			siteId: site.id,
			visitorId: visitor.id,
			pageThreadId: thread.id,
			siteKey: input.siteKey,
			pageKey: input.pageKey,
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
				mode: challenge.mode,
				provider: this.getCurrentProviderKind(),
			},
		});

		return {
			required: true,
			verified: false,
			mode: challenge.mode,
			challenge,
			visitorKey: publicVisitorKey,
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
		const { site, configuredSite, visitor, thread } =
			await this.resolveContext(input);
		const policy = await this.resolvePolicy({
			siteId: site.id,
			configuredSite,
		});
		if (policy.captchaMode !== "threshold") {
			return;
		}

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
				siteKey: input.siteKey,
				pageKey: input.pageKey,
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
					mode: this.getCurrentHostMode(),
					provider: this.getCurrentProviderKind(),
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
		const { site, configuredSite, visitor, thread } =
			await this.resolveContext(input);
		const policy = await this.resolvePolicy({
			siteId: site.id,
			configuredSite,
		});
		if (policy.captchaMode === "never") {
			return {
				required: false,
				verified: true,
			};
		}

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
		if (activeSession.mode !== "inline_value") {
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

		const payload = this.parseSessionPayload(activeSession);
		if (
			!isInlineCaptchaSessionPayload(payload) ||
			!verifyImageCaptchaValue(payload, input.value)
		) {
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
					provider: activeSession.providerKind ?? "image",
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
				provider: activeSession.providerKind ?? "image",
			},
		});
		return {
			required: true,
			verified: true,
		};
	}

	public async getWidgetHtml(input: {
		siteKey: string;
		pageKey: string;
		challengeId: string;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
	}) {
		const { site, visitor, thread } = await this.resolveContext(input);
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
		if (activeSession.mode !== "iframe_widget" || activeSession.verified) {
			throw new AppError(
				400,
				"COMMENT_CAPTCHA_REQUIRED",
				"请先完成验证码验证。",
			);
		}

		const providerKind =
			(activeSession.providerKind as PublicCaptchaProviderKind | null) ??
			this.getCurrentProviderKind();
		const completePath = "/api/comments/captcha/complete";

		switch (providerKind) {
			case "turnstile": {
				const config = this.requireTurnstileConfig();
				return renderTurnstileWidgetHtml({
					challengeId: input.challengeId,
					commentsSiteKey: input.siteKey,
					pageKey: input.pageKey,
					turnstileSiteKey: config.siteKey,
					completePath,
					expectedAction: config.expectedAction,
				});
			}
			case "hcaptcha": {
				const config = this.requireHCaptchaConfig();
				return renderHCaptchaWidgetHtml({
					challengeId: input.challengeId,
					commentsSiteKey: input.siteKey,
					pageKey: input.pageKey,
					hcaptchaSiteKey: config.siteKey,
					completePath,
				});
			}
			case "recaptcha": {
				const config = this.requireRecaptchaConfig();
				return renderRecaptchaWidgetHtml({
					challengeId: input.challengeId,
					commentsSiteKey: input.siteKey,
					pageKey: input.pageKey,
					recaptchaSiteKey: config.siteKey,
					expectedAction: config.expectedAction,
					variant: config.variant,
					completePath,
				});
			}
			case "geetest": {
				const config = this.requireGeeTestConfig();
				return renderGeeTestWidgetHtml({
					challengeId: input.challengeId,
					commentsSiteKey: input.siteKey,
					pageKey: input.pageKey,
					captchaId: config.captchaId,
					completePath,
				});
			}
			default:
				throw new AppError(
					400,
					"COMMENT_CAPTCHA_REQUIRED",
					"当前验证码不支持组件模式。",
				);
		}
	}

	public async completeWidgetChallenge(input: {
		siteKey: string;
		pageKey: string;
		challengeId: string;
		token?: string;
		lotNumber?: string;
		captchaOutput?: string;
		passToken?: string;
		genTime?: string;
		requestId?: string;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
	}) {
		const { site, visitor, thread } = await this.resolveContext(input);
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
		if (activeSession.mode !== "iframe_widget") {
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

		const rule = this.config.security.rateLimit.captchaVerify;
		const identityKey = visitor.visitorKey || input.ip || "anonymous";
		const snapshot = this.security.peekRateLimit({
			key: `public:${input.siteKey}:${identityKey}:captcha_verify`,
			rule,
		});
		if (snapshot.limit !== null && snapshot.count >= snapshot.limit) {
			throw new AppError(
				429,
				"COMMENT_RATE_LIMITED",
				"验证码尝试次数过多，请稍后再试。",
				{
					resetAt: snapshot.resetAt,
				},
			);
		}

		const providerKind =
			(activeSession.providerKind as PublicCaptchaProviderKind | null) ??
			this.getCurrentProviderKind();

		try {
			switch (providerKind) {
				case "turnstile": {
					const config = this.requireTurnstileConfig();
					if (!input.token) {
						throw new AppError(
							400,
							"COMMENT_CAPTCHA_INVALID",
							"缺少验证码令牌。",
						);
					}
					await verifyTurnstileToken({
						secretKey: config.secretKey,
						token: input.token,
						remoteIp: input.ip,
						expectedAction: config.expectedAction,
						expectedHostname: config.expectedHostname,
					});
					break;
				}
				case "hcaptcha": {
					const config = this.requireHCaptchaConfig();
					if (!input.token) {
						throw new AppError(
							400,
							"COMMENT_CAPTCHA_INVALID",
							"缺少验证码令牌。",
						);
					}
					await verifyHCaptchaToken({
						secretKey: config.secretKey,
						siteKey: config.siteKey,
						token: input.token,
						remoteIp: input.ip,
						expectedHostname: config.expectedHostname,
					});
					break;
				}
				case "recaptcha": {
					const config = this.requireRecaptchaConfig();
					if (!input.token) {
						throw new AppError(
							400,
							"COMMENT_CAPTCHA_INVALID",
							"缺少验证码令牌。",
						);
					}
					await verifyRecaptchaToken({
						projectId: config.projectId,
						apiKey: config.apiKey,
						siteKey: config.siteKey,
						token: input.token,
						expectedAction: config.expectedAction,
						minScore: config.minScore,
						userAgent: input.userAgent,
						userIpAddress: input.ip,
						expectedHostname: config.expectedHostname,
					});
					break;
				}
				case "geetest": {
					const config = this.requireGeeTestConfig();
					if (
						!input.lotNumber ||
						!input.captchaOutput ||
						!input.passToken ||
						!input.genTime
					) {
						throw new AppError(
							400,
							"COMMENT_CAPTCHA_INVALID",
							"缺少验证码结果。",
						);
					}
					await verifyGeeTestToken({
						apiServer: config.apiServer,
						captchaId: config.captchaId,
						captchaKey: config.captchaKey,
						lotNumber: input.lotNumber,
						captchaOutput: input.captchaOutput,
						passToken: input.passToken,
						genTime: input.genTime,
					});
					break;
				}
				default:
					throw new AppError(
						400,
						"COMMENT_CAPTCHA_REQUIRED",
						"当前验证码不支持组件模式。",
					);
			}
		} catch (error) {
			if (
				error instanceof AppError &&
				error.code === "COMMENT_CAPTCHA_INVALID"
			) {
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
						provider: providerKind,
					},
				});
				await this.security.consumeRateLimit({
					key: `public:${input.siteKey}:${identityKey}:captcha_verify`,
					rule,
					errorCode: "COMMENT_RATE_LIMITED",
					errorMessage: "验证码尝试次数过多，请稍后再试。",
				});
			}
			throw error;
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
				provider: providerKind,
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
		const { site, configuredSite, visitor, thread } =
			await this.resolveContext(input);
		const policy = await this.resolvePolicy({
			siteId: site.id,
			configuredSite,
		});
		if (policy.captchaMode === "never") {
			return;
		}

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
