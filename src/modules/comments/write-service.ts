import type { AppConfig } from "../../config/types";
import { AppError, ResourceNotFoundError } from "../shared/errors";
import type { SecurityToolkit } from "../../plugins/security";
import type { CommentsRepository } from "./repository";
import type { CaptchaService } from "./captcha-service";
import { buildCommentForm } from "./comment-form";
import type { CommentMetadataResolver } from "./metadata/resolver";
import type { CommentsWriteRepository } from "./write-repository";

function resolveIdentity(
	siteKey: string,
	visitorKey: string,
	ip?: string,
): string {
	return `${siteKey}:${visitorKey || ip || "anonymous"}`;
}

export class CommentsWriteService {
	public constructor(
		private readonly config: AppConfig,
		private readonly security: SecurityToolkit,
		private readonly readRepository: CommentsRepository,
		private readonly writeRepository: CommentsWriteRepository,
		private readonly captchaService: CaptchaService,
		private readonly metadataResolver?: CommentMetadataResolver,
	) {}

	public async createComment(input: {
		siteKey: string;
		pageKey: string;
		pageTitle: string;
		pageUrl: string;
		parentCommentId: string | null;
		author: {
			name?: string;
			email?: string;
			website?: string;
		};
		contentRaw: string;
		captcha?: {
			challengeId: string;
			value: string;
		} | null;
		requestId?: string;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
	}) {
		const site = this.readRepository.getRegisteredSite(input.siteKey);
		const configuredSite = this.readRepository.getConfiguredSite(input.siteKey);
		if (!site || !configuredSite) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const visitor = await this.readRepository.getOrCreateVisitor({
			siteId: site.id,
			visitorKey: input.visitorKey,
			ip: input.ip,
			userAgent: input.userAgent,
		});
		const thread = await this.readRepository.getOrCreatePageThread({
			siteId: site.id,
			pageKey: input.pageKey,
			pageTitle: input.pageTitle,
			pageUrl: input.pageUrl,
		});
		const settings = await this.readRepository.getRuntimeSettings(site.id);
		const commentsEnabled =
			settings?.commentsEnabled ?? configuredSite.defaults.comments.enabled;
		if (!commentsEnabled) {
			throw new AppError(403, "COMMENTS_DISABLED", "评论功能未开启。");
		}

		const commentForm = buildCommentForm(configuredSite, {
			allowWebsite:
				settings?.allowWebsite ?? configuredSite.defaults.comments.allowWebsite,
			commentRequireJson: settings?.commentRequireJson,
		});
		const authorName = input.author.name?.trim() ?? "";
		const authorEmail = input.author.email?.trim() || undefined;
		const authorWebsite = input.author.website?.trim() || undefined;
		if (commentForm.require.includes("nickname") && !authorName) {
			throw new AppError(400, "COMMENT_VALIDATION_FAILED", "评论参数不完整。");
		}
		if (commentForm.require.includes("email") && !authorEmail) {
			throw new AppError(400, "COMMENT_VALIDATION_FAILED", "评论参数不完整。");
		}
		if (commentForm.require.includes("website") && !authorWebsite) {
			throw new AppError(400, "COMMENT_VALIDATION_FAILED", "评论参数不完整。");
		}

		await this.security.assertNotBlacklisted({
			requestId: input.requestId,
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			visitorKey: visitor.visitorKey,
			email: authorEmail,
			ip: input.ip,
			requestScope: "write",
			errorCode: "COMMENT_BLACKLISTED",
			errorMessage: "当前请求已被拒绝。",
		});
		await this.security.consumeRateLimit({
			key: `public:${resolveIdentity(input.siteKey, visitor.visitorKey, input.ip)}:comment_create`,
			rule: this.config.security.rateLimit.commentCreate,
			errorCode: "COMMENT_RATE_LIMITED",
			errorMessage: "提交过于频繁，请稍后再试。",
		});
		await this.captchaService.markWriteAction({
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			pageTitle: input.pageTitle,
			pageUrl: input.pageUrl,
			action: "comment_create",
			requestId: input.requestId,
			visitorKey: visitor.visitorKey,
			ip: input.ip,
			userAgent: input.userAgent,
		});
		if (input.captcha) {
			await this.captchaService.consumeInlineCaptcha({
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				challengeId: input.captcha.challengeId,
				value: input.captcha.value,
				action: "comment_create",
				requestId: input.requestId,
				visitorKey: visitor.visitorKey,
				ip: input.ip,
				userAgent: input.userAgent,
			});
		}
		await this.captchaService.ensureSatisfied({
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			action: "comment_create",
			visitorKey: visitor.visitorKey,
			ip: input.ip,
			userAgent: input.userAgent,
		});

		if (input.parentCommentId) {
			const parentComment = await this.writeRepository.getCommentById(
				input.parentCommentId,
			);
			if (!parentComment || parentComment.pageThreadId !== thread.id) {
				throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
			}
		}

		const status = (settings?.defaultStatus ??
			configuredSite.defaults.comments.defaultStatus) as "pending" | "approved";
		const metadataConfig = this.readRepository.resolveCommentMetadata(
			configuredSite,
			settings,
		);
		const requestMetadata = this.metadataResolver
			? await this.metadataResolver.resolve({
					ip: metadataConfig.collectIp ? input.ip : undefined,
					userAgent: metadataConfig.collectUserAgent
						? input.userAgent
						: undefined,
					metadata: metadataConfig,
				})
			: undefined;
		const created = await this.writeRepository.createComment({
			siteId: site.id,
			pageThreadId: thread.id,
			parentCommentId: input.parentCommentId,
			visitorId: visitor.id,
			authorName,
			authorEmail,
			authorWebsite: commentForm.allow.includes("website")
				? authorWebsite
				: undefined,
			authorIp: metadataConfig.collectIp ? input.ip : undefined,
			authorUserAgent: metadataConfig.collectUserAgent
				? input.userAgent
				: undefined,
			metadata: requestMetadata,
			contentRaw: input.contentRaw,
			status,
		});

		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			actorType: "visitor",
			actorId: visitor.visitorKey,
			event: "comments.created",
			message: status === "pending" ? "评论已提交待审核" : "评论已发布",
			targetType: "comment",
			targetId: created.commentId,
			payload: {
				status,
				pageKey: input.pageKey,
			},
		});
		const abuseGuardEnabled =
			settings?.abuseGuardEnabled ??
			configuredSite.defaults.comments.abuseGuard.enabled;
		const autoBlacklistEnabled =
			settings?.autoBlacklistEnabled ??
			configuredSite.defaults.comments.abuseGuard.autoBlacklist.enabled;
		if (abuseGuardEnabled && autoBlacklistEnabled) {
			await this.security.recordAbuseWriteAction({
				requestId: input.requestId,
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				ip: input.ip,
				rule: {
					windowSec:
						settings?.abuseGuardWindowSec ??
						configuredSite.defaults.comments.abuseGuard.windowSec,
					maxRequests:
						settings?.abuseGuardMaxWriteActions ??
						configuredSite.defaults.comments.abuseGuard.maxWriteActions,
				},
				scope:
					(settings?.autoBlacklistScope as "post" | "all" | undefined) ??
					configuredSite.defaults.comments.abuseGuard.autoBlacklist.scope,
				ttlSec:
					settings?.autoBlacklistTtlSec ??
					configuredSite.defaults.comments.abuseGuard.autoBlacklist.ttlSec,
			});
		}

		return {
			visitorKey: visitor.created ? visitor.visitorKey : undefined,
			comment: {
				id: created.commentId,
				status,
				message:
					status === "pending" ? "评论已提交，等待审核。" : "评论已发布。",
			},
			thread: {
				commentCount: created.thread.commentCount,
				rootCommentCount: created.thread.rootCommentCount,
			},
		};
	}

	public async castVote(input: {
		commentId: string;
		siteKey: string;
		pageKey: string;
		choice: "up" | "down";
		captcha?: {
			challengeId: string;
			value: string;
		} | null;
		requestId?: string;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
	}) {
		const site = this.readRepository.getRegisteredSite(input.siteKey);
		const configuredSite = this.readRepository.getConfiguredSite(input.siteKey);
		if (!site || !configuredSite) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const visitor = await this.readRepository.getOrCreateVisitor({
			siteId: site.id,
			visitorKey: input.visitorKey,
			ip: input.ip,
			userAgent: input.userAgent,
		});
		const thread = await this.readRepository.getOrCreatePageThread({
			siteId: site.id,
			pageKey: input.pageKey,
		});
		const comment = await this.writeRepository.getCommentById(input.commentId);
		if (!comment || comment.pageThreadId !== thread.id) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}
		const settings = await this.readRepository.getRuntimeSettings(site.id);

		await this.security.assertNotBlacklisted({
			requestId: input.requestId,
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			visitorKey: visitor.visitorKey,
			ip: input.ip,
			requestScope: "write",
			errorCode: "COMMENT_BLACKLISTED",
			errorMessage: "当前请求已被拒绝。",
		});
		await this.security.consumeRateLimit({
			key: `public:${resolveIdentity(input.siteKey, visitor.visitorKey, input.ip)}:comment_vote`,
			rule: this.config.security.rateLimit.commentVote,
			errorCode: "VOTE_RATE_LIMITED",
			errorMessage: "投票过于频繁，请稍后再试。",
		});
		await this.captchaService.markWriteAction({
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			action: "comment_vote",
			requestId: input.requestId,
			visitorKey: visitor.visitorKey,
			ip: input.ip,
			userAgent: input.userAgent,
		});
		if (input.captcha) {
			await this.captchaService.consumeInlineCaptcha({
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				challengeId: input.captcha.challengeId,
				value: input.captcha.value,
				action: "comment_vote",
				requestId: input.requestId,
				visitorKey: visitor.visitorKey,
				ip: input.ip,
				userAgent: input.userAgent,
			});
		}
		await this.captchaService.ensureSatisfied({
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			action: "comment_vote",
			visitorKey: visitor.visitorKey,
			ip: input.ip,
			userAgent: input.userAgent,
		});

		const existingVote = await this.writeRepository.getVoteRecord(
			input.commentId,
			visitor.id,
		);
		if (existingVote) {
			throw new AppError(
				409,
				"VOTE_ALREADY_CAST",
				"你已经投过票，当前不允许再次修改。",
			);
		}

		const updatedComment = await this.writeRepository.createVote({
			commentId: input.commentId,
			visitorId: visitor.id,
			choice: input.choice,
		});
		if (!updatedComment) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}

		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			actorType: "visitor",
			actorId: visitor.visitorKey,
			action: "comment.vote",
			targetType: "comment",
			targetId: input.commentId,
			payload: {
				choice: input.choice,
			},
		});
		const abuseGuardEnabled =
			settings?.abuseGuardEnabled ??
			configuredSite.defaults.comments.abuseGuard.enabled;
		const autoBlacklistEnabled =
			settings?.autoBlacklistEnabled ??
			configuredSite.defaults.comments.abuseGuard.autoBlacklist.enabled;
		if (abuseGuardEnabled && autoBlacklistEnabled) {
			await this.security.recordAbuseWriteAction({
				requestId: input.requestId,
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				ip: input.ip,
				rule: {
					windowSec:
						settings?.abuseGuardWindowSec ??
						configuredSite.defaults.comments.abuseGuard.windowSec,
					maxRequests:
						settings?.abuseGuardMaxWriteActions ??
						configuredSite.defaults.comments.abuseGuard.maxWriteActions,
				},
				scope:
					(settings?.autoBlacklistScope as "post" | "all" | undefined) ??
					configuredSite.defaults.comments.abuseGuard.autoBlacklist.scope,
				ttlSec:
					settings?.autoBlacklistTtlSec ??
					configuredSite.defaults.comments.abuseGuard.autoBlacklist.ttlSec,
			});
		}

		return {
			visitorKey: visitor.created ? visitor.visitorKey : undefined,
			commentId: input.commentId,
			voteUp: updatedComment.voteUpCount,
			voteDown: updatedComment.voteDownCount,
			viewerVote: input.choice,
		};
	}
}
