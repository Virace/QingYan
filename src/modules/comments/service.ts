import { AppError, ResourceNotFoundError } from "../shared/errors";
import { normalizePagination } from "../shared/pagination";
import { mergePageRegistrySettings } from "../shared/page-registry-settings";
import {
	assertPublicPageAdmission,
	resolvePublicPageAdmission,
} from "../shared/public-page-admission";
import {
	type CommentMetadataSettings,
	defaultCommentMetadata,
	mergeEngagementSettings,
} from "../shared/site-settings-defaults";
import type { SystemSettings } from "../system-settings/definitions";
import type { CaptchaService } from "./captcha-service";
import { buildCommentForm } from "./comment-form";
import { resolveRequestMetadata } from "./metadata/request-metadata";
import type { CommentMetadataResolver } from "./metadata/resolver";
import { buildPublicFeatures, isSystemMailUsable } from "./public-contract";
import type { CommentsRepository } from "./repository";
import {
	mergeStaffDisplaySettings,
	mergeVerifiedAuthorSettings,
	type StaffDisplaySettings,
	toPublicVerifiedAuthorViewer,
	type VerifiedAuthorSettings,
} from "./verified-author";

export function buildCommentDisplayOptions(input: {
	metadata?: CommentMetadataSettings;
	avatar: SystemSettings["avatar"];
	verifiedAuthor: VerifiedAuthorSettings;
	staffDisplay?: StaffDisplaySettings;
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
		verifiedAuthor: {
			enabled: input.verifiedAuthor.enabled,
			displayName: input.verifiedAuthor.displayName,
			badgeLabel: input.verifiedAuthor.badgeLabel,
		},
		staffDisplay: input.staffDisplay ?? mergeStaffDisplaySettings(null),
	};
}

function buildPublicCommentDisplay(
	options: ReturnType<typeof buildCommentDisplayOptions>,
	input?: {
		includeAdvisoryFields?: boolean;
	},
) {
	return {
		avatar: {
			external: {
				enabled: options.avatar.external.enabled,
			},
			...(input?.includeAdvisoryFields
				? {
						display: options.avatar.display,
					}
				: {}),
		},
	};
}

function buildEmptyThread(input: {
	siteId: number;
	pageKey: string;
	pageTitle?: string;
	pageUrl?: string;
}) {
	return {
		id: 0,
		siteId: input.siteId,
		pageKey: input.pageKey,
		pageTitle: input.pageTitle ?? null,
		pageUrl: input.pageUrl ?? null,
		commentCount: 0,
		rootCommentCount: 0,
		pageViewCount: 0,
		pageLikeCount: 0,
		createdAt: "",
		updatedAt: "",
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
	verifiedAuthorSession?: { type: "admin" };
}

export class CommentsService {
	public constructor(
		private readonly repository: CommentsRepository,
		private readonly captchaService?: CaptchaService,
		private readonly loadAvatarSettings?: () => Promise<
			SystemSettings["avatar"]
		>,
		private readonly loadPublicApiSettings?: () => Promise<
			SystemSettings["publicApi"]
		>,
		private readonly metadataResolver?: CommentMetadataResolver,
		private readonly loadIpRegionSettings?: () => Promise<
			SystemSettings["ipRegion"]
		>,
		private readonly loadSystemSettings?: () => Promise<SystemSettings>,
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
		const existingThread = await this.repository.getPageThread({
			siteId: site.id,
			pageKey: input.pageKey,
		});
		const registryPage = await this.repository.getPageRegistryEntry({
			siteId: site.id,
			pageKey: input.pageKey,
		});
		const settings = await this.repository.getSiteSettings(site.id);
		const pageRegistrySettings = mergePageRegistrySettings(
			settings?.pageRegistryJson,
		);
		const admission = resolvePublicPageAdmission({
			registryPage,
			settings: pageRegistrySettings,
		});
		if (
			admission.kind === "unknown" &&
			!admission.allowDiscoveryWrites &&
			admission.response === "forbidden"
		) {
			assertPublicPageAdmission(admission);
		}
		const pageInteractive = admission.pageInteractive;
		const engagement = mergeEngagementSettings(settings?.engagementJson);
		const verifiedAuthor = mergeVerifiedAuthorSettings(
			settings?.verifiedAuthorJson,
		);
		const staffDisplay = mergeStaffDisplaySettings(settings?.staffDisplayJson);
		const publicVerifiedAuthor = input.verifiedAuthorSession
			? toPublicVerifiedAuthorViewer(verifiedAuthor)
			: undefined;
		const avatarSettings: SystemSettings["avatar"] = this.loadAvatarSettings
			? await this.loadAvatarSettings()
			: {
					external: {
						enabled: false,
						baseUrl: "https://gravatar.com/avatar",
						hashAlgorithm: "sha256",
						query: "s=80&d=404&r=g",
					},
					display: {
						shape: "circle",
						sizePx: 40,
					},
				};
		const publicApiSettings = this.loadPublicApiSettings
			? await this.loadPublicApiSettings()
			: { advisoryFields: { enabled: false } };
		const systemSettings = this.loadSystemSettings
			? await this.loadSystemSettings()
			: undefined;
		const metadataConfig = this.repository.resolveCommentMetadata(
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
		const visitor =
			pageInteractive && engagement.visitors.enabled
				? await this.repository.getOrCreateVisitor({
						siteId: site.id,
						visitorKey: input.visitorKey,
						ip: requestMetadata.ip,
						userAgent: requestMetadata.userAgent,
						metadata: requestMetadata.snapshot,
						pageKey: input.pageKey,
						pageUrl: input.pageUrl,
					})
				: undefined;
		let thread = existingThread;
		if (
			!thread &&
			pageInteractive &&
			admission.kind === "registered" &&
			engagement.pageViews.enabled
		) {
			thread = await this.repository.ensurePageThreadForRegisteredPage({
				siteId: site.id,
				pageKey: input.pageKey,
				pageTitle: input.pageTitle,
				pageUrl: input.pageUrl,
			});
		}
		if (thread && pageInteractive && engagement.pageViews.enabled) {
			if (visitor) {
				await this.repository.recordPageView({
					pageThreadId: thread.id,
					visitorId: visitor.id,
					pageKey: input.pageKey,
					userAgent: input.userAgent,
				});
			} else {
				await this.repository.recordLightweightPageView({
					pageThreadId: thread.id,
				});
			}
		}
		if (
			!thread &&
			pageInteractive &&
			admission.kind === "unknown" &&
			admission.allowDiscoveryWrites &&
			engagement.pageViews.enabled
		) {
			if (engagement.visitors.enabled) {
				await this.repository.recordPendingPageView({
					siteKey: site.siteKey,
					pageKey: input.pageKey,
					pageUrl: input.pageUrl ?? input.pageKey,
					visitorKey: visitor?.visitorKey ?? input.visitorKey,
					ip: input.ip,
					userAgent: input.userAgent,
				});
			} else {
				await this.repository.recordLightweightPendingPageView({
					siteKey: site.siteKey,
					pageKey: input.pageKey,
					pageUrl: input.pageUrl ?? input.pageKey,
				});
			}
		}
		const refreshedThread =
			thread && pageInteractive
				? await this.repository.getPageThread({
						siteId: site.id,
						pageKey: input.pageKey,
					})
				: undefined;
		const commentBundle =
			thread && pageInteractive
				? await this.repository.listPublicComments({
						pageThreadId: thread.id,
						sortBy: pagination.sortBy,
						limit: pagination.limit,
						offset: pagination.offset,
						visitorId: visitor?.id,
					})
				: {
						totalCount: 0,
						rootCount: 0,
						comments: [],
						viewerVoteMap: new Map<string, "up" | "down">(),
					};
		const pageFeedback =
			thread && pageInteractive
				? await this.repository.getViewerPageFeedback(thread.id, visitor?.id)
				: {
						liked: false,
					};
		const captcha =
			this.captchaService && thread && visitor && pageInteractive
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

		const commentDisplay = buildCommentDisplayOptions({
			metadata: metadataConfig,
			avatar: avatarSettings,
			verifiedAuthor,
			staffDisplay,
		});

		return {
			site: {
				siteKey: site.siteKey,
			},
			page: {
				pageKey: input.pageKey,
				status: pageInteractive ? "active" : (registryPage?.status ?? "active"),
			},
			features: buildPublicFeatures({
				pageInteractive,
				commentsEnabled: settings?.commentsEnabled ?? true,
				maxDepth: settings?.maxDepth ?? 3,
				captchaMode: (settings?.captchaMode ?? "threshold") as
					| "never"
					| "always"
					| "threshold",
				engagement,
				systemMailUsable: systemSettings
					? isSystemMailUsable(systemSettings.mail)
					: false,
				commenterReplyEmailEnabled:
					settings?.commenterReplyEmailEnabled ?? false,
			}),
			form: buildCommentForm({
				allowWebsite: settings?.allowWebsite,
				commentRequireJson: settings?.commentRequireJson,
			}),
			thread:
				refreshedThread ??
				buildEmptyThread({
					siteId: site.id,
					pageKey: input.pageKey,
					pageTitle: input.pageTitle,
					pageUrl: input.pageUrl,
				}),
			pagination: {
				sortBy: pagination.sortBy,
				limit: pagination.limit,
				offset: pagination.offset,
				totalCount: commentBundle.totalCount,
				rootCount: commentBundle.rootCount,
			},
			commentBundle,
			displayOptions: commentDisplay,
			display: buildPublicCommentDisplay(commentDisplay, {
				includeAdvisoryFields: publicApiSettings.advisoryFields.enabled,
			}),
			viewer: {
				...(publicVerifiedAuthor
					? { verifiedAuthor: publicVerifiedAuthor }
					: {}),
			},
			pageLikes: {
				count: refreshedThread?.pageLikeCount ?? 0,
				liked: pageFeedback.liked,
			},
			captcha: {
				required: captcha.required,
				verified: captcha.verified,
				mode: captcha.mode,
				...(captcha.challenge ? { challenge: captcha.challenge } : {}),
			},
			visitorKey: visitor?.created ? visitor.visitorKey : undefined,
		};
	}

	public async getThread(input: BootstrapInput) {
		const site = this.repository.getRegisteredSite(input.siteKey);
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const pagination = normalizePagination(input);
		const thread = await this.repository.getPageThread({
			siteId: site.id,
			pageKey: input.pageKey,
		});
		const settings = await this.repository.getSiteSettings(site.id);
		if (!(settings?.commentsEnabled ?? true)) {
			throw new AppError(403, "COMMENTS_DISABLED", "评论功能未开启。");
		}
		const registryPage = await this.repository.getPageRegistryEntry({
			siteId: site.id,
			pageKey: input.pageKey,
		});
		if (
			registryPage?.status === "trash" ||
			registryPage?.status === "deleted" ||
			registryPage?.status === "ignored"
		) {
			throw new AppError(403, "PAGE_INACTIVE", "页面当前不可用。");
		}
		const engagement = mergeEngagementSettings(settings?.engagementJson);
		const metadataConfig = this.repository.resolveCommentMetadata(
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
		const visitor =
			thread && engagement.visitors.enabled
				? await this.repository.getOrCreateVisitor({
						siteId: site.id,
						visitorKey: input.visitorKey,
						ip: requestMetadata.ip,
						userAgent: requestMetadata.userAgent,
						metadata: requestMetadata.snapshot,
						pageKey: input.pageKey,
						pageUrl: input.pageUrl,
					})
				: undefined;
		const commentBundle = thread
			? await this.repository.listPublicComments({
					pageThreadId: thread.id,
					sortBy: pagination.sortBy,
					limit: pagination.limit,
					offset: pagination.offset,
					visitorId: visitor?.id,
				})
			: {
					totalCount: 0,
					rootCount: 0,
					comments: [],
					viewerVoteMap: new Map<string, "up" | "down">(),
				};
		const verifiedAuthor = mergeVerifiedAuthorSettings(
			settings?.verifiedAuthorJson,
		);
		const staffDisplay = mergeStaffDisplaySettings(settings?.staffDisplayJson);
		const avatarSettings: SystemSettings["avatar"] = this.loadAvatarSettings
			? await this.loadAvatarSettings()
			: {
					external: {
						enabled: false,
						baseUrl: "https://gravatar.com/avatar",
						hashAlgorithm: "sha256",
						query: "s=80&d=404&r=g",
					},
					display: {
						shape: "circle",
						sizePx: 40,
					},
				};
		const publicApiSettings = this.loadPublicApiSettings
			? await this.loadPublicApiSettings()
			: { advisoryFields: { enabled: false } };

		const commentDisplay = buildCommentDisplayOptions({
			metadata: metadataConfig,
			avatar: avatarSettings,
			verifiedAuthor,
			staffDisplay,
		});

		return {
			thread:
				thread ??
				buildEmptyThread({
					siteId: site.id,
					pageKey: input.pageKey,
					pageTitle: input.pageTitle,
					pageUrl: input.pageUrl,
				}),
			pagination: {
				sortBy: pagination.sortBy,
				limit: pagination.limit,
				offset: pagination.offset,
				totalCount: commentBundle.totalCount,
				rootCount: commentBundle.rootCount,
			},
			commentBundle,
			displayOptions: commentDisplay,
			commentVotesEnabled: engagement.commentVotes.enabled,
			display: buildPublicCommentDisplay(commentDisplay, {
				includeAdvisoryFields: publicApiSettings.advisoryFields.enabled,
			}),
			visitorKey: visitor?.created ? visitor.visitorKey : undefined,
		};
	}
}
