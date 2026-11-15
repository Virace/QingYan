import type { AppConfig } from "../../config/types";
import type { SecurityToolkit } from "../../plugins/security";
import { CommenterPreferencesRepository } from "../notifications/commenter-preferences-repository";
import { assertCommentInputLimits } from "../shared/comment-input-limits";
import { AppError, ResourceNotFoundError } from "../shared/errors";
import { resolvePublicPageUrl } from "../shared/page-url";
import {
	mergeEngagementSettings,
	resolveEngagementTrustMode,
} from "../shared/site-settings-defaults";
import { normalizeSafeHttpUrl } from "../shared/url-policy";
import type { WriteQuotaLease } from "../shared/write-quota";
import type { SystemSettings } from "../system-settings/definitions";
import { requireCommentAccount } from "./account-identity";
import type { CaptchaService } from "./captcha-service";
import { buildCommentForm } from "./comment-form";
import {
	assertEmailPolicy,
	isNumericComment,
	normalizeCommentEmail,
	readEmailPolicy,
} from "./email-policy";
import { LocalReviewService } from "./local-review";
import { resolveRequestMetadata } from "./metadata/request-metadata";
import type { CommentMetadataResolver } from "./metadata/resolver";
import type { ModerationService } from "./moderation-service";
import {
	type CommentStatus,
	mergeSiteModerationSettings,
	resolvePublicCommentStatus,
} from "./moderation-types";
import { isSystemMailUsable } from "./public-contract";
import type { CommentsRepository } from "./repository";
import { SecuritySubjectService } from "./security-subject";
import { mergeVerifiedAuthorSettings } from "./verified-author";
import {
	type CaptchaAuthorization,
	CommentsWriteRepository,
} from "./write-repository";

type WriteContext = {
	siteKey: string;
	pageKey: string;
	securityToken?: string;
	visitorKey?: string;
	ip?: string;
	userAgent?: string;
	requestId?: string;
	captcha?: { challengeId: string; value: string } | null;
};

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

	private async recordRejection(
		input: WriteContext & { email?: string },
		siteId: number,
		error: unknown,
	) {
		if (
			error instanceof AppError &&
			(error.statusCode === 429 ||
				[
					"COMMENT_CONTENT_NUMERIC_ONLY",
					"COMMENT_EMAIL_LOGIN_REQUIRED",
					"COMMENT_EMAIL_NOT_ALLOWED",
					"COMMENT_CAPTCHA_INVALID",
					"VOTE_ALREADY_CAST",
					"PAGE_FEEDBACK_ALREADY_LIKED",
				].includes(error.code))
		) {
			await this.security.recordWriteViolation({
				siteId,
				siteKey: input.siteKey,
				ip: input.ip,
				visitorKey: input.visitorKey,
				email: input.email,
				reason: error.statusCode === 429 ? "rate_limited" : error.code,
			});
		}
	}

	public async createComment(
		input: WriteContext & {
			pageTitle: string;
			pageUrl: string;
			parentCommentId: string | null;
			author: { name?: string; email?: string; website?: string };
			contentRaw: string;
			verifiedAuthorSession?: {
				type: "admin";
				userId?: number;
				displayName?: string;
				email?: string;
				website?: string | null;
			};
			options?: { notifyOnReply?: boolean };
		},
	) {
		const site = this.readRepository.getRegisteredSite(input.siteKey);
		if (!site)
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		let lease: WriteQuotaLease | undefined;
		let authorization: CaptchaAuthorization | undefined;
		let committed = false;
		let authorEmail: string | undefined;
		try {
			await this.readRepository.assertPageInteractive({
				siteId: site.id,
				pageKey: input.pageKey,
			});
			const settings = await this.readRepository.getSiteSettings(site.id);
			const account = input.verifiedAuthorSession?.userId
				? await requireCommentAccount(
						this.writeRepository.database,
						input.verifiedAuthorSession.userId,
						site.id,
					)
				: undefined;
			const authorName =
				account?.displayName ?? input.author.name?.trim() ?? "";
			const suppliedEmail = account?.email ?? input.author.email?.trim();
			authorEmail = suppliedEmail
				? normalizeCommentEmail(suppliedEmail)
				: undefined;
			const authorWebsiteInput =
				account?.website ?? input.author.website?.trim();
			assertCommentInputLimits(
				{
					pageKey: input.pageKey,
					pageTitle: input.pageTitle,
					authorName,
					authorWebsite: authorWebsiteInput ?? undefined,
					contentRaw: input.contentRaw,
				},
				settings?.commentInputLimitsJson,
			);
			if (isNumericComment(input.contentRaw))
				throw new AppError(
					400,
					"COMMENT_CONTENT_NUMERIC_ONLY",
					"评论不能只有数字，请补充具体内容。",
				);
			if (!(settings?.commentsEnabled ?? true))
				throw new AppError(403, "COMMENTS_DISABLED", "评论功能未开启。");
			const form = buildCommentForm({
				allowWebsite: settings?.allowWebsite,
				commentRequireJson: settings?.commentRequireJson,
			});
			const verifiedAuthor = mergeVerifiedAuthorSettings(
				settings?.verifiedAuthorJson,
			);
			assertEmailPolicy({
				email: authorEmail,
				policy: readEmailPolicy(settings?.emailPolicyJson),
				reservedEmail: verifiedAuthor.email || undefined,
				authenticated: Boolean(account),
			});
			const authorWebsite = authorWebsiteInput
				? normalizeSafeHttpUrl(authorWebsiteInput)
				: undefined;
			if (
				!account &&
				((form.require.includes("nickname") && !authorName) ||
					(form.require.includes("email") && !authorEmail) ||
					(form.require.includes("website") && !authorWebsite))
			)
				throw new AppError(
					400,
					"COMMENT_VALIDATION_FAILED",
					"评论参数不完整。",
				);
			await this.security.assertNotBlacklisted({
				...input,
				email: authorEmail,
				requestScope: "write",
				errorCode: "COMMENT_BLACKLISTED",
				errorMessage: "当前请求已被拒绝。",
			});
			const subject = await new SecuritySubjectService(
				this.writeRepository.database,
			).resolve(site.id, input.securityToken);
			const context = { ...input, securityToken: subject.token };
			lease = this.security.reserveWriteQuota({
				siteId: site.id,
				siteKey: input.siteKey,
				ip: input.ip,
				subject: account ? `account:${account.id}` : subject.id,
				action: "comment_create",
				rule: await this.security.getRateLimitRule("commentCreate"),
				settings,
			});
			const trustedAuthor = Boolean(account && verifiedAuthor.enabled);
			if (!trustedAuthor)
				authorization = (
					await this.captchaService.prepareWrite({
						...context,
						action: "comment_create",
					})
				).authorization;
			if (input.parentCommentId) {
				const existingThread = await this.readRepository.getPageThread({
					siteId: site.id,
					pageKey: input.pageKey,
				});
				const parent = await this.writeRepository.getCommentById(
					input.parentCommentId,
				);
				if (
					!parent ||
					parent.siteId !== site.id ||
					parent.pageThreadId !== existingThread?.id
				)
					throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
			}
			const metadata = await resolveRequestMetadata({
				resolver: this.metadataResolver,
				ip: input.ip,
				userAgent: input.userAgent,
				metadata: this.readRepository.resolveCommentMetadata(
					settings ?? undefined,
				),
				ipRegion: await this.loadIpRegionSettings?.(),
			});
			const moderationSettings = mergeSiteModerationSettings(
				settings?.moderationJson,
				(settings?.defaultStatus ?? "pending") as "pending" | "approved",
			);
			const absolutePageUrl = resolvePublicPageUrl(
				input.pageUrl,
				site.allowedOrigins ?? [],
			);
			let moderation = trustedAuthor
				? undefined
				: await this.moderationService?.reviewComment({
						siteModeration: moderationSettings,
						blog: site.allowedOrigins?.[0] ?? this.config.server.publicBaseUrl,
						userIp: input.ip,
						userAgent: input.userAgent,
						referrer: absolutePageUrl ?? undefined,
						permalink: absolutePageUrl ?? undefined,
						commentType: input.parentCommentId ? "reply" : "comment",
						commentAuthor: authorName,
						commentAuthorEmail: authorEmail,
						commentAuthorUrl: authorWebsite,
						commentContent: input.contentRaw,
						commentDateGmt: new Date().toISOString(),
					});
			if (
				moderation?.akismetVerdict === "ham" &&
				moderationSettings.mode === "akismet_auto" &&
				moderationSettings.localReviewEnabled
			) {
				const evidence = await new LocalReviewService(
					this.writeRepository.database,
				).evaluate({
					siteId: site.id,
					authorName,
					authorEmail,
					ip: metadata.ip,
					userAgent: metadata.userAgent,
				});
				moderation = {
					...moderation,
					provider: "combined",
					status: evidence.decision,
					decision: evidence.decision === "approved" ? "approve" : "pending",
					reason: evidence.reason,
					localReview: evidence,
				};
			}
			const status: CommentStatus = trustedAuthor
				? "approved"
				: (moderation?.status ??
					((settings?.defaultStatus ?? "pending") as CommentStatus));
			const engagement = mergeEngagementSettings(settings?.engagementJson);
			const system = await this.loadSystemSettings?.();
			const notificationUsable =
				(settings?.maxDepth ?? 3) > 1 &&
				(settings?.commenterReplyEmailEnabled ?? false) &&
				Boolean(system && isSystemMailUsable(system.mail));
			const created = await this.writeRepository.database.transaction(
				async (tx) => {
					lease?.assertActive();
					await this.security.assertWriteCommitAllowed(tx, {
						siteId: site.id,
						siteKey: input.siteKey,
						ip: input.ip,
						visitorKey: input.visitorKey,
						email: authorEmail,
					});
					await this.security.assertNotBlacklisted(
						{
							...input,
							email: authorEmail,
							requestScope: "write",
							errorCode: "COMMENT_BLACKLISTED",
							errorMessage: "当前请求已被拒绝。",
						},
						tx,
					);
					if (account) {
						const currentAccount = await requireCommentAccount(
							tx,
							account.id,
							site.id,
						);
						if (
							currentAccount.displayName !== account.displayName ||
							currentAccount.email !== account.email ||
							currentAccount.website !== account.website
						)
							throw new AppError(
								409,
								"COMMENT_ACCOUNT_CHANGED",
								"账号资料已更新，请重新提交评论。",
							);
					}
					const reader = this.readRepository.withDatabase(tx);
					const writer = new CommentsWriteRepository(tx);
					await writer.consumeCaptchaAuthorization(authorization);
					const thread = await reader.getOrCreatePageThread({
						siteId: site.id,
						pageKey: input.pageKey,
						pageTitle: input.pageTitle,
						pageUrl: input.pageUrl,
					});
					const visitor = engagement.visitors.enabled
						? await reader.getOrCreateVisitor({
								siteId: site.id,
								visitorKey: input.visitorKey,
								ip: metadata.ip,
								userAgent: metadata.userAgent,
								metadata: metadata.snapshot,
								pageKey: input.pageKey,
								pageUrl: input.pageUrl,
							})
						: undefined;
					if (!account)
						await new CommenterPreferencesRepository(tx).upsertFromCommentForm({
							siteId: site.id,
							email: authorEmail,
							notifyOnReply:
								notificationUsable && (input.options?.notifyOnReply ?? false),
						});
					const result = await writer.createComment({
						siteId: site.id,
						pageThreadId: thread.id,
						parentCommentId: input.parentCommentId,
						visitorId: visitor?.id ?? null,
						authorUserId: account?.id,
						authorIdentity: account ? "staff" : "visitor",
						authorName,
						authorEmail,
						authorWebsite:
							account || form.allow.includes("website")
								? authorWebsite
								: undefined,
						authorIp: metadata.ip,
						authorUserAgent: metadata.userAgent,
						metadata: metadata.snapshot,
						contentRaw: input.contentRaw,
						status,
						moderation,
						notification: {
							siteKey: input.siteKey,
							pageKey: input.pageKey,
							source: trustedAuthor ? "admin_reply" : "public_api",
							notifyBackend: !trustedAuthor,
							notifyReply: Boolean(
								input.parentCommentId && status === "approved",
							),
							actorType: account ? "admin_user" : "visitor",
							actorId: account ? String(account.id) : subject.id,
						},
					});
					lease?.assertActive();
					return { ...result, visitor };
				},
			);
			lease.commit();
			committed = true;
			const createdComment = await this.writeRepository.getCommentById(
				created.commentId,
			);
			if (!createdComment)
				throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
			await this.security.writeAudit({
				requestId: input.requestId,
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				actorType: account ? "admin_user" : "visitor",
				actorId: account ? String(account.id) : subject.id,
				event: "comments.created",
				message: status === "approved" ? "评论已发布" : "评论已提交审核",
				targetType: "comment",
				targetId: created.commentId,
				payload: { status, pageKey: input.pageKey },
			});
			return {
				visitorKey: created.visitor?.created
					? created.visitor.visitorKey
					: undefined,
				securityToken: subject.token,
				createdComment,
				comment: {
					id: created.commentId,
					status: resolvePublicCommentStatus(status),
					message:
						status === "approved" ? "评论已发布。" : "评论已提交，等待审核。",
				},
				thread: {
					commentCount: created.thread.commentCount,
					rootCommentCount: created.thread.rootCommentCount,
				},
			};
		} catch (error) {
			if (!committed)
				await this.recordRejection(
					{ ...input, email: authorEmail },
					site.id,
					error,
				);
			throw error;
		} finally {
			lease?.release();
			if (!committed)
				await this.captchaService.releaseAuthorization(authorization);
		}
	}

	public async castVote(
		input: WriteContext & { commentId: string; choice: "up" | "down" },
	) {
		const site = this.readRepository.getRegisteredSite(input.siteKey);
		if (!site)
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		let lease: WriteQuotaLease | undefined;
		let authorization: CaptchaAuthorization | undefined;
		let committed = false;
		try {
			await this.readRepository.assertPageInteractive({
				siteId: site.id,
				pageKey: input.pageKey,
			});
			const thread = await this.readRepository.getPageThread({
				siteId: site.id,
				pageKey: input.pageKey,
			});
			const comment = await this.writeRepository.getCommentById(
				input.commentId,
			);
			if (
				!comment ||
				comment.siteId !== site.id ||
				comment.pageThreadId !== thread?.id
			)
				throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
			const settings = await this.readRepository.getSiteSettings(site.id);
			const engagement = mergeEngagementSettings(settings?.engagementJson);
			if (!engagement.commentVotes.enabled)
				throw new AppError(
					403,
					"COMMENT_VOTE_DISABLED",
					"评论投票功能未开启。",
				);
			await this.security.assertNotBlacklisted({
				...input,
				requestScope: "write",
				errorCode: "COMMENT_BLACKLISTED",
				errorMessage: "当前请求已被拒绝。",
			});
			const subject = await new SecuritySubjectService(
				this.writeRepository.database,
			).resolve(site.id, input.securityToken);
			lease = this.security.reserveWriteQuota({
				siteId: site.id,
				siteKey: input.siteKey,
				ip: input.ip,
				subject: subject.id,
				action: "comment_vote",
				rule: await this.security.getRateLimitRule("commentVote"),
				settings,
			});
			authorization = (
				await this.captchaService.prepareWrite({
					...input,
					securityToken: subject.token,
					action: "comment_vote",
				})
			).authorization;
			const metadata = await resolveRequestMetadata({
				resolver: this.metadataResolver,
				ip: input.ip,
				userAgent: input.userAgent,
				metadata: this.readRepository.resolveCommentMetadata(
					settings ?? undefined,
				),
				ipRegion: await this.loadIpRegionSettings?.(),
			});
			const result = await this.writeRepository.database.transaction(
				async (tx) => {
					lease?.assertActive();
					await this.security.assertWriteCommitAllowed(tx, {
						siteId: site.id,
						siteKey: input.siteKey,
						ip: input.ip,
						visitorKey: input.visitorKey,
					});
					const writer = new CommentsWriteRepository(tx);
					await writer.consumeCaptchaAuthorization(authorization);
					const visitor = engagement.visitors.enabled
						? await this.readRepository.withDatabase(tx).getOrCreateVisitor({
								siteId: site.id,
								visitorKey: input.visitorKey,
								ip: metadata.ip,
								userAgent: metadata.userAgent,
								metadata: metadata.snapshot,
								pageKey: input.pageKey,
							})
						: undefined;
					const updated = visitor
						? await writer.createVote({
								commentId: input.commentId,
								visitorId: visitor.id,
								choice: input.choice,
							})
						: await writer.incrementCommentVote({
								commentId: input.commentId,
								choice: input.choice,
							});
					if (!updated)
						throw new ResourceNotFoundError(
							"COMMENT_NOT_FOUND",
							"评论不存在。",
						);
					lease?.assertActive();
					return { updated, visitor };
				},
			);
			lease.commit();
			committed = true;
			await this.security.writeAudit({
				requestId: input.requestId,
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				actorType: "visitor",
				actorId: subject.id,
				action: "comment.vote",
				targetType: "comment",
				targetId: input.commentId,
				payload: {
					choice: input.choice,
					trustMode: resolveEngagementTrustMode(engagement),
				},
			});
			return {
				visitorKey: result.visitor?.created
					? result.visitor.visitorKey
					: undefined,
				securityToken: subject.token,
				commentId: input.commentId,
				vote: {
					up: result.updated.voteUpCount,
					down: result.updated.voteDownCount,
					viewer: input.choice,
				},
			};
		} catch (error) {
			if (!committed) await this.recordRejection(input, site.id, error);
			throw error;
		} finally {
			lease?.release();
			if (!committed)
				await this.captchaService.releaseAuthorization(authorization);
		}
	}
}
