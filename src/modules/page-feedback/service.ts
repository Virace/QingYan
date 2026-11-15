import type { SecurityToolkit } from "../../plugins/security";
import type { CaptchaService } from "../comments/captcha-service";
import { resolveRequestMetadata } from "../comments/metadata/request-metadata";
import type { CommentMetadataResolver } from "../comments/metadata/resolver";
import type { CommentsRepository } from "../comments/repository";
import { SecuritySubjectService } from "../comments/security-subject";
import {
	type CaptchaAuthorization,
	CommentsWriteRepository,
} from "../comments/write-repository";
import { assertCommentInputLimits } from "../shared/comment-input-limits";
import { AppError, ResourceNotFoundError } from "../shared/errors";
import {
	mergeEngagementSettings,
	resolveEngagementTrustMode,
} from "../shared/site-settings-defaults";
import type { WriteQuotaLease } from "../shared/write-quota";
import type { SystemSettings } from "../system-settings/definitions";
import { PageFeedbackRepository } from "./repository";

export class PageFeedbackService {
	public constructor(
		private readonly security: SecurityToolkit,
		private readonly commentsRepository: CommentsRepository,
		private readonly captchaService: CaptchaService,
		private readonly pageFeedbackRepository: PageFeedbackRepository,
		private readonly metadataResolver?: CommentMetadataResolver,
		private readonly loadIpRegionSettings?: () => Promise<
			SystemSettings["ipRegion"]
		>,
	) {}

	public async likePage(input: {
		siteKey: string;
		pageKey: string;
		pageTitle: string;
		pageUrl: string;
		captcha?: { challengeId: string; value: string } | null;
		visitorKey?: string;
		securityToken?: string;
		ip?: string;
		userAgent?: string;
	}) {
		const site = this.commentsRepository.getRegisteredSite(input.siteKey);
		if (!site)
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		let lease: WriteQuotaLease | undefined;
		let authorization: CaptchaAuthorization | undefined;
		let committed = false;
		try {
			await this.commentsRepository.assertPageInteractive({
				siteId: site.id,
				pageKey: input.pageKey,
			});
			const settings = await this.commentsRepository.getSiteSettings(site.id);
			assertCommentInputLimits(
				{ pageKey: input.pageKey, pageTitle: input.pageTitle },
				settings?.commentInputLimitsJson,
			);
			const engagement = mergeEngagementSettings(settings?.engagementJson);
			if (!engagement.pageLikes.enabled)
				throw new AppError(
					403,
					"PAGE_FEEDBACK_DISABLED",
					"页面点赞功能未开启。",
				);
			await this.security.assertNotBlacklisted({
				...input,
				requestScope: "write",
				errorCode: "COMMENT_BLACKLISTED",
				errorMessage: "当前请求已被拒绝。",
			});
			const subject = await new SecuritySubjectService(
				this.pageFeedbackRepository.getDatabase(),
			).resolve(site.id, input.securityToken);
			lease = this.security.reserveWriteQuota({
				siteId: site.id,
				siteKey: input.siteKey,
				ip: input.ip,
				subject: subject.id,
				action: "page_like",
				rule: await this.security.getRateLimitRule("pageLike"),
				settings,
			});
			authorization = (
				await this.captchaService.prepareWrite({
					...input,
					securityToken: subject.token,
					action: "page_like",
				})
			).authorization;
			const metadata = await resolveRequestMetadata({
				resolver: this.metadataResolver,
				ip: input.ip,
				userAgent: input.userAgent,
				metadata: this.commentsRepository.resolveCommentMetadata(
					settings ?? undefined,
				),
				ipRegion: await this.loadIpRegionSettings?.(),
			});
			const result = await this.pageFeedbackRepository
				.getDatabase()
				.transaction(async (tx) => {
					lease?.assertActive();
					await this.security.assertWriteCommitAllowed(tx, {
						siteId: site.id,
						siteKey: input.siteKey,
						ip: input.ip,
						visitorKey: input.visitorKey,
					});
					await new CommentsWriteRepository(tx).consumeCaptchaAuthorization(
						authorization,
					);
					const reader = this.commentsRepository.withDatabase(tx);
					const repository = new PageFeedbackRepository(tx);
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
					const updated = visitor
						? await repository.createLike(thread.id, visitor.id)
						: await repository.incrementPageLike(thread.id);
					if (!updated)
						throw new ResourceNotFoundError(
							"THREAD_NOT_FOUND",
							"页面线程不存在。",
						);
					lease?.assertActive();
					return { updated, visitor };
				});
			lease.commit();
			committed = true;
			await this.security.writeAudit({
				siteKey: input.siteKey,
				actorType: "visitor",
				actorId: subject.id,
				action: "page.like",
				targetType: "page_thread",
				targetId: String(result.updated.id),
				payload: { trustMode: resolveEngagementTrustMode(engagement) },
			});
			return {
				visitorKey: result.visitor?.created
					? result.visitor.visitorKey
					: undefined,
				securityToken: subject.token,
				pageLikes: { count: result.updated.pageLikeCount, liked: true },
			};
		} catch (error) {
			if (
				!committed &&
				error instanceof AppError &&
				(error.statusCode === 429 ||
					error.code === "PAGE_FEEDBACK_ALREADY_LIKED")
			)
				await this.security.recordWriteViolation({
					siteId: site.id,
					siteKey: input.siteKey,
					ip: input.ip,
					visitorKey: input.visitorKey,
					reason: error.statusCode === 429 ? "rate_limited" : error.code,
				});
			throw error;
		} finally {
			lease?.release();
			if (!committed)
				await this.captchaService.releaseAuthorization(authorization);
		}
	}
}
