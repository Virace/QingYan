import type { SecurityToolkit } from "../../plugins/security";
import type { CaptchaService } from "../comments/captcha-service";
import { resolveRequestMetadata } from "../comments/metadata/request-metadata";
import type { CommentMetadataResolver } from "../comments/metadata/resolver";
import type { CommentsRepository } from "../comments/repository";
import { AppError, ResourceNotFoundError } from "../shared/errors";
import {
	mergeEngagementSettings,
	resolveEngagementTrustMode,
} from "../shared/site-settings-defaults";
import type { SystemSettings } from "../system-settings/definitions";
import type { PageFeedbackRepository } from "./repository";

function resolveIdentity(
	siteKey: string,
	visitorKey: string,
	ip?: string,
): string {
	return `${siteKey}:${visitorKey || ip || "anonymous"}`;
}

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
		captcha?: {
			challengeId: string;
			value: string;
		} | null;
		visitorKey?: string;
		ip?: string;
		userAgent?: string;
	}) {
		const site = this.commentsRepository.getRegisteredSite(input.siteKey);
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}
		await this.commentsRepository.assertPageInteractive({
			siteId: site.id,
			pageKey: input.pageKey,
		});

		const settings = await this.commentsRepository.getSiteSettings(site.id);
		const engagement = mergeEngagementSettings(settings?.engagementJson);
		const trustMode = resolveEngagementTrustMode(engagement);
		if (!engagement.pageLikes.enabled) {
			throw new AppError(403, "PAGE_FEEDBACK_DISABLED", "页面点赞功能未开启。");
		}
		const metadataConfig = this.commentsRepository.resolveCommentMetadata(
			settings ?? undefined,
		);
		const requestMetadata = await resolveRequestMetadata({
			resolver: this.metadataResolver,
			ip: input.ip,
			userAgent: input.userAgent,
			metadata: metadataConfig,
			ipRegion: this.loadIpRegionSettings
				? await this.loadIpRegionSettings()
				: undefined,
		});

		const visitor = engagement.visitors.enabled
			? await this.commentsRepository.getOrCreateVisitor({
					siteId: site.id,
					visitorKey: input.visitorKey,
					ip: requestMetadata.ip,
					userAgent: requestMetadata.userAgent,
					metadata: requestMetadata.snapshot,
					pageKey: input.pageKey,
					pageUrl: input.pageUrl,
				})
			: undefined;
		const thread = await this.commentsRepository.getOrCreatePageThread({
			siteId: site.id,
			pageKey: input.pageKey,
			pageTitle: input.pageTitle,
			pageUrl: input.pageUrl,
		});

		await this.security.assertNotBlacklisted({
			siteKey: input.siteKey,
			visitorKey: visitor?.visitorKey,
			ip: input.ip,
			requestScope: "write",
			errorCode: "COMMENT_BLACKLISTED",
			errorMessage: "当前请求已被拒绝。",
		});
		await this.security.consumeRateLimit({
			key: `public:${resolveIdentity(input.siteKey, visitor?.visitorKey ?? "", input.ip)}:page_like`,
			rule: await this.security.getRateLimitRule("pageLike"),
			errorCode: "VOTE_RATE_LIMITED",
			errorMessage: "提交过于频繁，请稍后再试。",
		});
		if (visitor && input.captcha) {
			await this.captchaService.consumeInlineCaptcha({
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				challengeId: input.captcha.challengeId,
				value: input.captcha.value,
				action: "page_like",
				visitorKey: visitor.visitorKey,
				ip: input.ip,
				userAgent: input.userAgent,
			});
		}
		if (visitor) {
			await this.captchaService.ensureSatisfied({
				siteKey: input.siteKey,
				pageKey: input.pageKey,
				action: "page_like",
				visitorKey: visitor.visitorKey,
				ip: input.ip,
				userAgent: input.userAgent,
			});
		}

		if (!visitor) {
			const updatedThread = await this.pageFeedbackRepository.incrementPageLike(
				thread.id,
			);
			if (!updatedThread) {
				throw new ResourceNotFoundError("THREAD_NOT_FOUND", "页面线程不存在。");
			}

			await this.security.writeAudit({
				siteKey: input.siteKey,
				actorType: "visitor",
				actorId: input.ip ?? "anonymous",
				action: "page.like",
				targetType: "page_thread",
				targetId: String(thread.id),
				payload: {
					trustMode,
				},
			});

			return {
				visitorKey: undefined,
				pageLikes: {
					count: updatedThread.pageLikeCount,
					liked: true,
				},
			};
		}

		const existingLike = await this.pageFeedbackRepository.getLikeRecord(
			thread.id,
			visitor.id,
		);
		if (existingLike) {
			throw new AppError(
				409,
				"PAGE_FEEDBACK_ALREADY_LIKED",
				"你已经点过赞了。",
			);
		}

		const updatedThread = await this.pageFeedbackRepository.createLike(
			thread.id,
			visitor.id,
		);
		if (!updatedThread) {
			throw new ResourceNotFoundError("THREAD_NOT_FOUND", "页面线程不存在。");
		}

		await this.security.writeAudit({
			siteKey: input.siteKey,
			actorType: "visitor",
			actorId: visitor.visitorKey,
			action: "page.like",
			targetType: "page_thread",
			targetId: String(thread.id),
		});

		return {
			visitorKey: visitor.created ? visitor.visitorKey : undefined,
			pageLikes: {
				count: updatedThread.pageLikeCount,
				liked: true,
			},
		};
	}
}
