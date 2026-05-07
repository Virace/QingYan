import { ResourceNotFoundError } from "../shared/errors";
import { normalizePagination } from "../shared/pagination";
import {
	defaultCommentMetadata,
	type CommentMetadataSettings,
} from "../shared/site-settings-defaults";
import type { SystemSettings } from "../system-settings/definitions";
import type { CaptchaService } from "./captcha-service";
import { buildCommentForm } from "./comment-form";
import type { CommentsRepository } from "./repository";

function buildCapability(settings?: {
	commentsEnabled: boolean;
	defaultStatus: string;
	maxDepth: number;
	allowWebsite: boolean;
	allowPageLike: boolean;
	captchaMode: string;
}) {
	const supportsCaptcha = (settings?.captchaMode ?? "threshold") !== "never";

	return {
		enabled: settings?.commentsEnabled ?? true,
		supportsReply: (settings?.maxDepth ?? 3) > 1,
		supportsVote: true,
		supportsCaptcha,
		defaultStatus: settings?.defaultStatus ?? "pending",
		message: null,
	};
}

function buildCommentDisplayOptions(input: {
	metadata?: CommentMetadataSettings;
	avatar: SystemSettings["avatar"];
}) {
	const metadata = input.metadata ?? defaultCommentMetadata;
	return {
		location: {
			enabled: metadata.ipRegion.enabled,
			precision: metadata.ipRegion.precision,
		},
		device: {
			enabled: metadata.device.enabled && metadata.device.display.enabled,
		},
		avatar: input.avatar,
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
		private readonly loadAvatarSettings?: () => Promise<
			SystemSettings["avatar"]
		>,
	) {}

	public getRepository(): CommentsRepository {
		return this.repository;
	}

	public async getBootstrap(input: BootstrapInput) {
		const site = this.repository.getRegisteredSite(input.siteKey);
		if (!site) {
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
		const settings = await this.repository.getSiteSettings(site.id);
		const avatarSettings = this.loadAvatarSettings
			? await this.loadAvatarSettings()
			: {
					gravatar: {
						enabled: false,
						baseUrl: "https://gravatar.com/avatar",
					},
				};
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
			capability: buildCapability(settings ?? undefined),
			commentForm: buildCommentForm({
				allowWebsite: settings?.allowWebsite,
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
			commentDisplay: buildCommentDisplayOptions({
				metadata: this.repository.resolveCommentMetadata(settings ?? undefined),
				avatar: avatarSettings,
			}),
			pageMetrics: {
				pageViewCount: refreshedThread.pageViewCount,
			},
			pageFeedback: {
				supportsLike: settings?.allowPageLike ?? true,
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
		if (!site) {
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
		const settings = await this.repository.getSiteSettings(site.id);
		const avatarSettings = this.loadAvatarSettings
			? await this.loadAvatarSettings()
			: {
					gravatar: {
						enabled: false,
						baseUrl: "https://gravatar.com/avatar",
					},
				};

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
			commentDisplay: buildCommentDisplayOptions({
				metadata: this.repository.resolveCommentMetadata(settings ?? undefined),
				avatar: avatarSettings,
			}),
			visitorKey: visitor.created ? visitor.visitorKey : undefined,
		};
	}
}
