import type { SiteConfig } from "../../config/types";
import { ResourceNotFoundError } from "../shared/errors";
import { normalizePagination } from "../shared/pagination";
import type { CaptchaService } from "./captcha-service";
import { buildCommentForm } from "./comment-form";
import type { CommentsRepository } from "./repository";

function buildCapability(
	site: SiteConfig,
	settings?: {
		commentsEnabled: boolean;
		defaultStatus: string;
		maxDepth: number;
		allowWebsite: boolean;
		allowPageLike: boolean;
		captchaMode: string;
	},
) {
	const commentsDefaults = site.defaults.comments;
	const supportsCaptcha =
		(settings?.captchaMode ?? commentsDefaults.captcha.mode) !== "never";

	return {
		enabled: settings?.commentsEnabled ?? commentsDefaults.enabled,
		supportsReply: (settings?.maxDepth ?? commentsDefaults.maxDepth) > 1,
		supportsVote: true,
		supportsCaptcha,
		defaultStatus: settings?.defaultStatus ?? commentsDefaults.defaultStatus,
		message: null,
	};
}

function buildCommentDisplayOptions(
	site: SiteConfig,
	metadata = site.defaults.comments.metadata,
) {
	return {
		location: {
			enabled: metadata.ipRegion.enabled,
			precision: metadata.ipRegion.precision,
		},
		device: {
			enabled: metadata.device.enabled && metadata.device.display.enabled,
		},
	};
}

export interface BootstrapInput {
	siteKey: string;
	pageKey: string;
	pageTitle?: string;
	pageUrl?: string;
	sortBy?: string;
	limit?: number;
	offset?: number;
	visitorKey?: string;
	ip?: string;
	userAgent?: string;
}

export class CommentsService {
	public constructor(
		private readonly repository: CommentsRepository,
		private readonly captchaService?: CaptchaService,
	) {}

	public getRepository(): CommentsRepository {
		return this.repository;
	}

	public async getBootstrap(input: BootstrapInput) {
		const site = this.repository.getRegisteredSite(input.siteKey);
		const configuredSite = this.repository.getConfiguredSite(input.siteKey);
		if (!site || !configuredSite) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const pagination = normalizePagination(input);
		const visitor = await this.repository.getOrCreateVisitor({
			siteId: site.id,
			visitorKey: input.visitorKey,
			ip: input.ip,
			userAgent: input.userAgent,
		});
		const thread = await this.repository.getOrCreatePageThread({
			siteId: site.id,
			pageKey: input.pageKey,
			pageTitle: input.pageTitle,
			pageUrl: input.pageUrl,
		});
		await this.repository.recordPageView({
			pageThreadId: thread.id,
			visitorId: visitor.id,
			pageKey: input.pageKey,
			userAgent: input.userAgent,
		});
		const refreshedThread = await this.repository.getOrCreatePageThread({
			siteId: site.id,
			pageKey: input.pageKey,
			pageTitle: input.pageTitle,
			pageUrl: input.pageUrl,
		});
		const settings = await this.repository.getRuntimeSettings(site.id);
		const commentBundle = await this.repository.listPublicComments({
			pageThreadId: thread.id,
			sortBy: pagination.sortBy,
			limit: pagination.limit,
			offset: pagination.offset,
			visitorId: visitor.id,
		});
		const pageFeedback = await this.repository.getViewerPageFeedback(
			thread.id,
			visitor.id,
		);
		const captcha = this.captchaService
			? await this.captchaService.getState({
					siteKey: input.siteKey,
					pageKey: input.pageKey,
					pageTitle: input.pageTitle,
					pageUrl: input.pageUrl,
					visitorKey: visitor.visitorKey,
					ip: input.ip,
					userAgent: input.userAgent,
				})
			: {
					required: false,
					verified: false,
					mode: "inline_value" as const,
					challenge: null,
				};

		return {
			capability: buildCapability(configuredSite, settings ?? undefined),
			commentForm: buildCommentForm(configuredSite, {
				allowWebsite:
					settings?.allowWebsite ??
					configuredSite.defaults.comments.allowWebsite,
				commentRequireJson: settings?.commentRequireJson,
			}),
			thread: refreshedThread,
			pagination: {
				sortBy: pagination.sortBy,
				limit: pagination.limit,
				offset: pagination.offset,
				totalCount: commentBundle.totalCount,
				rootCount: commentBundle.rootCount,
			},
			commentBundle,
			commentDisplay: buildCommentDisplayOptions(
				configuredSite,
				this.repository.resolveCommentMetadata(
					configuredSite,
					settings ?? undefined,
				),
			),
			pageMetrics: {
				pageViewCount: refreshedThread.pageViewCount,
			},
			pageFeedback: {
				supportsLike:
					settings?.allowPageLike ??
					configuredSite.defaults.pageFeedback.allowLike,
				likeCount: refreshedThread.pageLikeCount,
				liked: pageFeedback.liked,
			},
			captcha: {
				required: captcha.required,
				verified: captcha.verified,
				mode: captcha.mode,
				challenge: captcha.challenge,
			},
			visitorKey: visitor.created ? visitor.visitorKey : undefined,
		};
	}

	public async getThread(input: BootstrapInput) {
		const site = this.repository.getRegisteredSite(input.siteKey);
		const configuredSite = this.repository.getConfiguredSite(input.siteKey);
		if (!site || !configuredSite) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const pagination = normalizePagination(input);
		const visitor = await this.repository.getOrCreateVisitor({
			siteId: site.id,
			visitorKey: input.visitorKey,
			ip: input.ip,
			userAgent: input.userAgent,
		});
		const thread = await this.repository.getOrCreatePageThread({
			siteId: site.id,
			pageKey: input.pageKey,
			pageTitle: input.pageTitle,
			pageUrl: input.pageUrl,
		});
		const commentBundle = await this.repository.listPublicComments({
			pageThreadId: thread.id,
			sortBy: pagination.sortBy,
			limit: pagination.limit,
			offset: pagination.offset,
			visitorId: visitor.id,
		});
		const settings = await this.repository.getRuntimeSettings(site.id);

		return {
			thread,
			pagination: {
				sortBy: pagination.sortBy,
				limit: pagination.limit,
				offset: pagination.offset,
				totalCount: commentBundle.totalCount,
				rootCount: commentBundle.rootCount,
			},
			commentBundle,
			commentDisplay: buildCommentDisplayOptions(
				configuredSite,
				this.repository.resolveCommentMetadata(
					configuredSite,
					settings ?? undefined,
				),
			),
			visitorKey: visitor.created ? visitor.visitorKey : undefined,
		};
	}
}
