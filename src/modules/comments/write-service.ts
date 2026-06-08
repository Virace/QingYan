import type { AppConfig } from "../../config/types";
import type { SecurityToolkit } from "../../plugins/security";
import { AppError, ResourceNotFoundError } from "../shared/errors";
import { assertCommentInputLimits } from "../shared/comment-input-limits";
import { normalizeSafeHttpUrl } from "../shared/url-policy";
import type { SystemSettings } from "../system-settings/definitions";
import type { CaptchaService } from "./captcha-service";
import { buildCommentForm } from "./comment-form";
import { resolveRequestMetadata } from "./metadata/request-metadata";
import type { CommentMetadataResolver } from "./metadata/resolver";
import type { ModerationService } from "./moderation-service";
import {
	type CommentStatus,
	mergeSiteModerationSettings,
	resolvePublicCommentStatus,
} from "./moderation-types";
import type { CommentsRepository } from "./repository";
import {
	isReservedVerifiedAuthorEmail,
	mergeVerifiedAuthorSettings,
} from "./verified-author";
import {
	mergeEngagementSettings,
	resolveEngagementTrustMode,
} from "../shared/site-settings-defaults";
import type { CommentsWriteRepository } from "./write-repository";
import { CommenterPreferencesRepository } from "../notifications/commenter-preferences-repository";
import { CommentNotificationPlanner } from "../notifications/comment-notification-planner";
import { isSystemMailUsable } from "./public-contract";

function resolveIdentity(
	siteKey: string,
	visitorKey: string,
	ip?: string,
): string {
	return `${siteKey}:${visitorKey || ip || "anonymous"}`;
}

function firstAllowedOrigin(site: {
	allowedOrigins?: string[];
}): string | undefined {
	return site.allowedOrigins?.[0];
}

export class CommentsWriteService {
	public constructor(
		private readonly config: AppConfig,
		private readonly security: SecurityToolkit,
		private readonly readRepository: CommentsRepository,
		private readonly writeRepository: CommentsWriteRepository,
		private readonly captchaService: CaptchaService,
		private readonly metadataResolver?: CommentMetadataResolver,
		private readonly loadIpRegionSettings?: () => Promise<
			SystemSettings["ipRegion"]
		>,
		private readonly moderationService?: ModerationService,
		private readonly loadSystemSettings?: () => Promise<SystemSettings>,
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
		verifiedAuthorSession?: {
			type: "admin";
			userId?: number;
			displayName?: string;
			email?: string;
			website?: string | null;
		};
		options?: {
			notifyOnReply?: boolean;
		};
	}) {
		const site = this.readRepository.getRegisteredSite(input.siteKey);
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}
		await this.readRepository.assertPageInteractive({
			siteId: site.id,
			pageKey: input.pageKey,
		});

		const settings = await this.readRepository.getSiteSettings(site.id);
		const authorName = input.author.name?.trim() ?? "";
		const authorEmail = input.author.email?.trim() || undefined;
		const authorWebsiteInput = input.author.website?.trim() || undefined;
		assertCommentInputLimits(
			{
				pageKey: input.pageKey,
				pageTitle: input.pageTitle,
				authorName,
				authorWebsite: authorWebsiteInput,
				contentRaw: input.contentRaw,
			},
			settings?.commentInputLimitsJson,
		);
		const thread = await this.readRepository.getOrCreatePageThread({
			siteId: site.id,
			pageKey: input.pageKey,
			pageTitle: input.pageTitle,
			pageUrl: input.pageUrl,
		});
		const engagement = mergeEngagementSettings(settings?.engagementJson);
		const metadataConfig = this.readRepository.resolveCommentMetadata(
			settings ?? undefined,
		);
		const ipRegionSettings = this.loadIpRegionSettings
			? await this.loadIpRegionSettings()
			: undefined;
		const requestMetadata = await resolveRequestMetadata({
			resolver: this.metadataResolver,
			ip: input.ip,
			userAgent: input.userAgent,
			metadata: metadataConfig,
			ipRegion: ipRegionSettings,
		});
		const visitor = engagement.visitors.enabled
			? await this.readRepository.getOrCreateVisitor({
					siteId: site.id,
					visitorKey: input.visitorKey,
					ip: requestMetadata.ip,
					userAgent: requestMetadata.userAgent,
					metadata: requestMetadata.snapshot,
					pageKey: input.pageKey,
					pageUrl: input.pageUrl,
				})
			: undefined;
		const commentsEnabled = settings?.commentsEnabled ?? true;
		if (!commentsEnabled) {
			throw new AppError(403, "COMMENTS_DISABLED", "评论功能未开启。");
		}

		const commentForm = buildCommentForm({
			allowWebsite: settings?.allowWebsite,
			commentRequireJson: settings?.commentRequireJson,
		});
		const verifiedAuthor = mergeVerifiedAuthorSettings(
			settings?.verifiedAuthorJson,
		);
		const shouldUseVerifiedAuthor =
			Boolean(input.verifiedAuthorSession) && verifiedAuthor.enabled;
		const authorWebsite = authorWebsiteInput
			? normalizeSafeHttpUrl(authorWebsiteInput)
			: undefined;
		if (
			!shouldUseVerifiedAuthor &&
			commentForm.require.includes("nickname") &&
			!authorName
		) {
			throw new AppError(400, "COMMENT_VALIDATION_FAILED", "评论参数不完整。");
		}
		if (
			!shouldUseVerifiedAuthor &&
			commentForm.require.includes("email") &&
			!authorEmail
		) {
			throw new AppError(400, "COMMENT_VALIDATION_FAILED", "评论参数不完整。");
		}
		if (
			!shouldUseVerifiedAuthor &&
			commentForm.require.includes("website") &&
			!authorWebsite
		) {
			throw new AppError(400, "COMMENT_VALIDATION_FAILED", "评论参数不完整。");
		}
		if (
			!shouldUseVerifiedAuthor &&
			isReservedVerifiedAuthorEmail(authorEmail, verifiedAuthor)
		) {
			throw new AppError(
				403,
				"VERIFIED_AUTHOR_EMAIL_RESERVED",
				"该邮箱仅允许可信作者登录后使用。",
			);
		}

		if (!shouldUseVerifiedAuthor) {
			await this.security.assertNotBlacklisted({
				requestId: input.requestId,
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				visitorKey: visitor?.visitorKey,
				email: authorEmail,
				ip: input.ip,
				requestScope: "write",
				errorCode: "COMMENT_BLACKLISTED",
				errorMessage: "当前请求已被拒绝。",
			});
			await this.security.consumeRateLimit({
				key: `public:${resolveIdentity(input.siteKey, visitor?.visitorKey ?? "", input.ip)}:comment_create`,
				rule: await this.security.getRateLimitRule("commentCreate"),
				errorCode: "COMMENT_RATE_LIMITED",
				errorMessage: "提交过于频繁，请稍后再试。",
			});
			if (visitor) {
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
			}
		}

		if (input.parentCommentId) {
			const parentComment = await this.writeRepository.getCommentById(
				input.parentCommentId,
			);
			if (!parentComment || parentComment.pageThreadId !== thread.id) {
				throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
			}
		}

		const legacyStatus = (settings?.defaultStatus ?? "pending") as
			| "pending"
			| "approved";
		const siteModeration = mergeSiteModerationSettings(
			settings?.moderationJson,
			legacyStatus,
		);
		const moderation = shouldUseVerifiedAuthor
			? undefined
			: await this.moderationService?.reviewComment({
					siteModeration,
					blog: firstAllowedOrigin(site) ?? this.config.server.publicBaseUrl,
					userIp: input.ip,
					userAgent: input.userAgent,
					permalink: input.pageUrl,
					commentType: input.parentCommentId ? "reply" : "comment",
					commentAuthor: authorName,
					commentAuthorEmail: authorEmail,
					commentAuthorUrl: authorWebsite,
					commentContent: input.contentRaw,
					commentDateGmt: new Date().toISOString(),
				});
		const status: CommentStatus = shouldUseVerifiedAuthor
			? "approved"
			: (moderation?.status ?? legacyStatus);
		const resolvedAuthorName = shouldUseVerifiedAuthor
			? (input.verifiedAuthorSession?.displayName ?? verifiedAuthor.displayName)
			: authorName;
		const resolvedAuthorEmail = shouldUseVerifiedAuthor
			? input.verifiedAuthorSession?.email || verifiedAuthor.email || undefined
			: authorEmail;
		const resolvedAuthorWebsite = shouldUseVerifiedAuthor
			? input.verifiedAuthorSession
				? (input.verifiedAuthorSession.website ?? undefined)
				: verifiedAuthor.website || undefined
			: authorWebsite;
		const created = await this.writeRepository.createComment({
			siteId: site.id,
			pageThreadId: thread.id,
			parentCommentId: input.parentCommentId,
			visitorId: visitor?.id ?? null,
			authorUserId: shouldUseVerifiedAuthor
				? input.verifiedAuthorSession?.userId
				: null,
			authorIdentity: shouldUseVerifiedAuthor ? "staff" : "visitor",
			authorName: resolvedAuthorName,
			authorEmail: resolvedAuthorEmail,
			authorWebsite:
				shouldUseVerifiedAuthor || commentForm.allow.includes("website")
					? resolvedAuthorWebsite
					: undefined,
			authorIp: requestMetadata.ip,
			authorUserAgent: requestMetadata.userAgent,
			metadata: requestMetadata.snapshot,
			contentRaw: input.contentRaw,
			status,
			moderation,
		});
		const createdComment = await this.writeRepository.getCommentById(
			created.commentId,
		);
		if (!createdComment) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}

		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			actorType: shouldUseVerifiedAuthor ? "admin_user" : "visitor",
			actorId: shouldUseVerifiedAuthor
				? String(input.verifiedAuthorSession?.userId ?? "admin_session")
				: (visitor?.visitorKey ?? input.ip ?? "anonymous"),
			event: "comments.created",
			message: status === "pending" ? "评论已提交待审核" : "评论已发布",
			targetType: "comment",
			targetId: created.commentId,
			payload: {
				status,
				pageKey: input.pageKey,
			},
		});
		if (!shouldUseVerifiedAuthor) {
			const systemSettings = this.loadSystemSettings
				? await this.loadSystemSettings()
				: undefined;
			const replyEmailNotificationUsable =
				commentsEnabled &&
				(settings?.maxDepth ?? 3) > 1 &&
				(settings?.commenterReplyEmailEnabled ?? false) &&
				Boolean(systemSettings && isSystemMailUsable(systemSettings.mail));
			await new CommenterPreferencesRepository(
				this.writeRepository.database,
			).upsertFromCommentForm({
				siteId: site.id,
				email: resolvedAuthorEmail,
				notifyOnReply:
					replyEmailNotificationUsable &&
					(input.options?.notifyOnReply ?? false),
			});
		}
		if (input.parentCommentId && status === "approved") {
			await this.planReplyNotification({
				siteId: site.id,
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				commentId: created.commentId,
				source: shouldUseVerifiedAuthor ? "admin_reply" : "public_api",
				actorType: shouldUseVerifiedAuthor ? "admin_user" : "visitor",
				actorId: shouldUseVerifiedAuthor
					? String(input.verifiedAuthorSession?.userId ?? "admin_session")
					: (visitor?.visitorKey ?? input.ip ?? "anonymous"),
				requestId: input.requestId,
			});
		}
		const abuseGuardEnabled = settings?.abuseGuardEnabled ?? true;
		const autoBlacklistEnabled = settings?.autoBlacklistEnabled ?? true;
		if (abuseGuardEnabled && autoBlacklistEnabled) {
			await this.security.recordAbuseWriteAction({
				requestId: input.requestId,
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				ip: input.ip,
				rule: {
					windowSec: settings?.abuseGuardWindowSec ?? 600,
					maxRequests: settings?.abuseGuardMaxWriteActions ?? 100,
				},
				scope:
					(settings?.autoBlacklistScope as "post" | "all" | undefined) ??
					"post",
				ttlSec: settings?.autoBlacklistTtlSec ?? 1800,
			});
		}

		return {
			visitorKey: visitor?.created ? visitor.visitorKey : undefined,
			createdComment,
			comment: {
				id: created.commentId,
				status: resolvePublicCommentStatus(status),
				message:
					resolvePublicCommentStatus(status) === "pending"
						? "评论已提交，等待审核。"
						: "评论已发布。",
			},
			thread: {
				commentCount: created.thread.commentCount,
				rootCommentCount: created.thread.rootCommentCount,
			},
		};
	}

	private async planReplyNotification(input: {
		siteId: number;
		siteKey: string;
		pageKey: string;
		commentId: string;
		source: "public_api" | "admin_reply";
		actorType: "admin_user" | "visitor";
		actorId: string;
		requestId?: string;
	}) {
		try {
			await new CommentNotificationPlanner(
				this.writeRepository.database,
			).planForCommentEvent(input);
		} catch (error) {
			await this.security
				.writeAudit({
					requestId: input.requestId,
					siteKey: input.siteKey,
					pageKey: input.pageKey,
					actorType: "system",
					actorId: "notification_planner",
					event: "notification.email.failed",
					message: "评论通知规划失败",
					targetType: "comment",
					targetId: input.commentId,
					payload: {
						source: input.source,
						error: error instanceof Error ? error.message : String(error),
					},
				})
				.catch(() => undefined);
		}
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
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}
		await this.readRepository.assertPageInteractive({
			siteId: site.id,
			pageKey: input.pageKey,
		});

		const thread = await this.readRepository.getOrCreatePageThread({
			siteId: site.id,
			pageKey: input.pageKey,
		});
		const comment = await this.writeRepository.getCommentById(input.commentId);
		if (!comment || comment.pageThreadId !== thread.id) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}
		const settings = await this.readRepository.getSiteSettings(site.id);
		const engagement = mergeEngagementSettings(settings?.engagementJson);
		const trustMode = resolveEngagementTrustMode(engagement);
		if (!engagement.commentVotes.enabled) {
			throw new AppError(403, "COMMENT_VOTE_DISABLED", "评论投票功能未开启。");
		}
		const metadataConfig = this.readRepository.resolveCommentMetadata(
			settings ?? undefined,
		);
		const ipRegionSettings = this.loadIpRegionSettings
			? await this.loadIpRegionSettings()
			: undefined;
		const requestMetadata = await resolveRequestMetadata({
			resolver: this.metadataResolver,
			ip: input.ip,
			userAgent: input.userAgent,
			metadata: metadataConfig,
			ipRegion: ipRegionSettings,
		});
		const visitor = engagement.visitors.enabled
			? await this.readRepository.getOrCreateVisitor({
					siteId: site.id,
					visitorKey: input.visitorKey,
					ip: requestMetadata.ip,
					userAgent: requestMetadata.userAgent,
					metadata: requestMetadata.snapshot,
					pageKey: input.pageKey,
				})
			: undefined;

		await this.security.assertNotBlacklisted({
			requestId: input.requestId,
			siteKey: input.siteKey,
			pageKey: input.pageKey,
			visitorKey: visitor?.visitorKey,
			ip: input.ip,
			requestScope: "write",
			errorCode: "COMMENT_BLACKLISTED",
			errorMessage: "当前请求已被拒绝。",
		});
		await this.security.consumeRateLimit({
			key: `public:${resolveIdentity(input.siteKey, visitor?.visitorKey ?? "", input.ip)}:comment_vote`,
			rule: await this.security.getRateLimitRule("commentVote"),
			errorCode: "VOTE_RATE_LIMITED",
			errorMessage: "投票过于频繁，请稍后再试。",
		});
		if (visitor) {
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
		}

		if (!visitor) {
			const updatedComment = await this.writeRepository.incrementCommentVote({
				commentId: input.commentId,
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
				actorId: input.ip ?? "anonymous",
				action: "comment.vote",
				targetType: "comment",
				targetId: input.commentId,
				payload: {
					choice: input.choice,
					trustMode,
				},
			});

			return {
				visitorKey: undefined,
				commentId: input.commentId,
				vote: {
					up: updatedComment.voteUpCount,
					down: updatedComment.voteDownCount,
					viewer: input.choice,
				},
			};
		}

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
		const abuseGuardEnabled = settings?.abuseGuardEnabled ?? true;
		const autoBlacklistEnabled = settings?.autoBlacklistEnabled ?? true;
		if (abuseGuardEnabled && autoBlacklistEnabled) {
			await this.security.recordAbuseWriteAction({
				requestId: input.requestId,
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				ip: input.ip,
				rule: {
					windowSec: settings?.abuseGuardWindowSec ?? 600,
					maxRequests: settings?.abuseGuardMaxWriteActions ?? 100,
				},
				scope:
					(settings?.autoBlacklistScope as "post" | "all" | undefined) ??
					"post",
				ttlSec: settings?.autoBlacklistTtlSec ?? 1800,
			});
		}

		return {
			visitorKey: visitor.created ? visitor.visitorKey : undefined,
			commentId: input.commentId,
			vote: {
				up: updatedComment.voteUpCount,
				down: updatedComment.voteDownCount,
				viewer: input.choice,
			},
		};
	}
}
