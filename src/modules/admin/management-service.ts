import type { SecurityToolkit } from "../../plugins/security";
import { buildCommentForm } from "../comments/comment-form";
import { DefaultCommentMetadataResolver } from "../comments/metadata/resolver";
import {
	type CommentStatus,
	mergeSiteModerationSettings,
	type SiteModerationSettings,
	serializeSiteModerationSettings,
} from "../comments/moderation-types";
import { presentComments } from "../comments/presenter";
import {
	mergeStaffDisplaySettings,
	mergeVerifiedAuthorSettings,
	type StaffDisplaySettings,
	serializeStaffDisplaySettings,
	serializeVerifiedAuthorSettings,
	type VerifiedAuthorSettings,
} from "../comments/verified-author";
import { CommentsWriteRepository } from "../comments/write-repository";
import { CommentNotificationPlanner } from "../notifications/comment-notification-planner";
import {
	AppError,
	InvalidRequestError,
	ResourceNotFoundError,
} from "../shared/errors";
import { buildPaginationResult } from "../shared/pagination";
import type { SiteRegistry } from "../shared/site-registry";
import {
	type CommentMetadataSettings,
	defaultCommentMetadata,
	type EngagementSettingsPatch,
	mergeEngagementSettings,
	mergeEngagementSettingsPatch,
	readPersistedBoolean,
	serializeEngagementSettings,
} from "../shared/site-settings-defaults";
import {
	normalizeOriginList,
	sanitizeOptionalSafeHttpUrl,
} from "../shared/url-policy";
import { RuntimeSystemSettingsService } from "../system-settings/service";
import type { AdminRepository } from "./repository";

type CommentMetadataPatch = {
	collectIp?: boolean | 0 | 1;
	collectUserAgent?: boolean | 0 | 1;
	ipRegion?: {
		enabled?: boolean | 0 | 1;
		precision?: "country" | "province" | "city";
	};
	device?: {
		enabled?: boolean | 0 | 1;
		display?: {
			enabled?: boolean | 0 | 1;
		};
	};
};

type NotificationRecipientInput = {
	userId: number;
	channels?: Array<"email" | "webhook" | "wxpusher">;
	events?: Array<"admin_comment_pending" | "admin_comment_approved">;
	routes?: Array<{
		eventType: "admin_comment_pending" | "admin_comment_approved";
		channelConfigId: string;
		enabled: boolean;
	}>;
	includeCommentContent: "none" | "summary" | "full";
	rateLimitProfile?: string | null;
	enabled: boolean;
};

function mergeCommentMetadata(
	payload?: string | null,
): CommentMetadataSettings {
	if (!payload) {
		return defaultCommentMetadata;
	}

	try {
		const parsed = JSON.parse(payload) as CommentMetadataPatch;
		return {
			...defaultCommentMetadata,
			...parsed,
			collectIp: readPersistedBoolean(
				parsed.collectIp,
				defaultCommentMetadata.collectIp,
			),
			collectUserAgent: readPersistedBoolean(
				parsed.collectUserAgent,
				defaultCommentMetadata.collectUserAgent,
			),
			ipRegion: {
				...defaultCommentMetadata.ipRegion,
				...parsed.ipRegion,
				enabled: readPersistedBoolean(
					parsed.ipRegion?.enabled,
					defaultCommentMetadata.ipRegion.enabled,
				),
			},
			device: {
				...defaultCommentMetadata.device,
				...parsed.device,
				enabled: readPersistedBoolean(
					parsed.device?.enabled,
					defaultCommentMetadata.device.enabled,
				),
				display: {
					...defaultCommentMetadata.device.display,
					...parsed.device?.display,
					enabled: readPersistedBoolean(
						parsed.device?.display?.enabled,
						defaultCommentMetadata.device.display.enabled,
					),
				},
			},
		};
	} catch {
		return defaultCommentMetadata;
	}
}

export class AdminManagementService {
	public constructor(
		private readonly security: SecurityToolkit,
		private readonly siteRegistry: SiteRegistry,
		private readonly repository: AdminRepository,
	) {}

	private async resolveSiteId(siteKey?: string) {
		if (!siteKey) {
			return undefined;
		}

		const site = this.siteRegistry.getRegisteredSite(siteKey);
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		return site.id;
	}

	private resolveSite(siteKey: string) {
		const registeredSite = this.siteRegistry.getRegisteredSite(siteKey);
		if (!registeredSite) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		return {
			registeredSite,
		};
	}

	public async listComments(input: {
		siteKey?: string;
		pageKey?: string;
		status?: CommentStatus;
		statusGroup?: "hidden";
		search?: string;
		limit: number;
		offset: number;
	}) {
		const siteId = await this.resolveSiteId(input.siteKey);
		const systemSettings = new RuntimeSystemSettingsService(
			this.repository.database,
		);
		const result = await this.repository.listComments({
			siteId,
			pageKey: input.pageKey,
			status: input.status,
			statusGroup: input.statusGroup,
			avatar: await systemSettings.getAvatarSettings(),
			search: input.search,
			limit: input.limit,
			offset: input.offset,
		});

		return buildPaginationResult(result.items, {
			limit: input.limit,
			offset: input.offset,
			totalCount: result.totalCount,
		});
	}

	public async listPages(input: {
		siteKey?: string;
		search?: string;
		status?:
			| "active"
			| "stale"
			| "unreachable"
			| "not_found"
			| "trash"
			| "deleted"
			| "ignored";
		sortBy:
			| "updatedAt"
			| "createdAt"
			| "commentCount"
			| "visitorCount"
			| "commenterCount"
			| "pageLikeCount"
			| "title"
			| "pageKey";
		sortOrder: "asc" | "desc";
		limit: number;
		offset: number;
	}) {
		const siteId = await this.resolveSiteId(input.siteKey);
		const result = await this.repository.listPages({
			siteId,
			search: input.search,
			status: input.status,
			sortBy: input.sortBy,
			sortOrder: input.sortOrder,
			limit: input.limit,
			offset: input.offset,
		});

		return buildPaginationResult(result.items, {
			limit: input.limit,
			offset: input.offset,
			totalCount: result.totalCount,
		});
	}

	public async listCommenters(input: {
		siteKey?: string;
		search?: string;
		limit: number;
		offset: number;
	}) {
		const siteId = await this.resolveSiteId(input.siteKey);
		const result = await this.repository.listCommenters({
			siteId,
			search: input.search,
			limit: input.limit,
			offset: input.offset,
		});

		return buildPaginationResult(result.items, {
			limit: input.limit,
			offset: input.offset,
			totalCount: result.totalCount,
		});
	}

	public async listVisitors(input: {
		siteKey?: string;
		search?: string;
		ip?: string;
		userAgent?: string;
		pageUrl?: string;
		device?: string;
		location?: string;
		blacklist?: "any" | "ip" | "visitor" | "none";
		limit: number;
		offset: number;
	}) {
		const siteId = await this.resolveSiteId(input.siteKey);
		if (siteId !== undefined) {
			const settings = await this.repository.getSiteSettings(siteId);
			const engagement = mergeEngagementSettings(settings?.engagementJson);
			if (!engagement.visitors.enabled) {
				return {
					enabled: false,
					trustMode: "lightweight" as const,
					items: [],
					pagination: {
						limit: input.limit,
						offset: input.offset,
						totalCount: 0,
					},
					message:
						"访客记录未启用。QingYan 当前不记录访客身份，也不提供访客画像。",
				};
			}
		}
		const result = await this.repository.listVisitors({
			siteId,
			search: input.search,
			ip: input.ip,
			userAgent: input.userAgent,
			pageUrl: input.pageUrl,
			device: input.device,
			location: input.location,
			blacklist: input.blacklist,
			limit: input.limit,
			offset: input.offset,
		});

		return {
			enabled: true,
			trustMode: "trusted" as const,
			...buildPaginationResult(result.items, {
				limit: input.limit,
				offset: input.offset,
				totalCount: result.totalCount,
			}),
		};
	}

	public async listSitesSummary() {
		const items = await this.repository.listSitesSummary();

		return {
			items: items.flatMap((item) => {
				const registeredSite = this.siteRegistry.getRegisteredSite(
					item.siteKey,
				);
				if (!registeredSite) {
					return [];
				}

				return [
					{
						siteKey: item.siteKey,
						name: item.name,
						allowedOrigins: item.allowedOrigins,
						comments: {
							enabled: item.comments.enabled,
							defaultStatus: item.comments.defaultStatus,
							identity: buildCommentForm({
								allowWebsite: item.comments.allowWebsite,
								commentRequireJson: item.comments.commentRequireJson,
							}),
							allowWebsite: item.comments.allowWebsite,
							captcha: item.comments.captcha,
							moderation: mergeSiteModerationSettings(
								item.comments.moderationJson,
								item.comments.defaultStatus as "pending" | "approved",
							),
						},
						pageFeedback: item.pageFeedback,
						engagement: item.engagement,
						notifications: item.notifications,
						pageCount: item.pageCount,
						commentCount: item.commentCount,
						commenterCount: item.commenterCount,
						visitorCount: item.visitorCount,
					},
				];
			}),
		};
	}

	public async createSite(input: {
		siteKey: string;
		name: string;
		allowedOrigins: string[];
		requestId?: string;
		actorUserId?: number;
	}) {
		const existingSite = await this.repository.getSiteByKey(input.siteKey);
		if (existingSite) {
			throw new InvalidRequestError({
				code: "SITE_KEY_EXISTS",
				message: "站点标识已存在。",
			});
		}

		const site = await this.repository.createSite({
			siteKey: input.siteKey,
			name: input.name,
			allowedOrigins: normalizeOriginList(input.allowedOrigins),
		});
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		await this.siteRegistry.loadFromDatabase(this.repository.database);
		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey: input.siteKey,
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			event: "sites.created",
			message: "站点已创建",
			targetType: "site",
			targetId: input.siteKey,
			payload: {
				name: input.name,
				allowedOrigins: input.allowedOrigins,
			},
		});

		return this.listSitesSummary();
	}

	public async updateSite(input: {
		siteKey: string;
		name?: string;
		allowedOrigins?: string[];
		requestId?: string;
		actorUserId?: number;
	}) {
		const existingSite = await this.repository.getSiteByKey(input.siteKey);
		if (!existingSite) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const site = await this.repository.updateSite(input.siteKey, {
			name: input.name,
			allowedOrigins: input.allowedOrigins
				? normalizeOriginList(input.allowedOrigins)
				: undefined,
		});
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		await this.siteRegistry.loadFromDatabase(this.repository.database);
		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey: input.siteKey,
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			event: "sites.updated",
			message: "站点已更新",
			targetType: "site",
			targetId: input.siteKey,
			payload: {
				name: input.name,
				allowedOrigins: input.allowedOrigins,
			},
		});

		return this.listSitesSummary();
	}

	public async getOverview(input: {
		consolePath: string;
		devMode: boolean;
		logging: {
			level: string;
			retentionDays: number;
			directory: string;
		};
	}) {
		const stats = await this.repository.getOverviewStats();

		return {
			console: {
				path: input.consolePath,
			},
			runtime: {
				devMode: input.devMode,
			},
			stats,
			logging: input.logging,
		};
	}

	public async updateComment(
		commentId: string,
		input: {
			status?: CommentStatus;
			isPinned?: boolean;
			isFolded?: boolean;
			contentRaw?: string;
			requestId?: string;
			actorUserId?: number;
		},
	) {
		const existingComment = await this.repository.getCommentById(commentId);
		const comment = await this.repository.updateComment(commentId, input);
		if (!comment) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}

		await this.security.writeAudit({
			requestId: input.requestId,
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			event: input.status ? "comments.status.changed" : "comments.updated",
			message: input.status ? "评论状态已更新" : "评论内容已更新",
			targetType: "comment",
			targetId: commentId,
		});
		if (
			input.status === "approved" &&
			existingComment?.status !== "approved" &&
			comment.parentId
		) {
			await this.planReplyNotification({
				commentId,
				source: "admin_moderation",
				requestId: input.requestId,
				actorUserId: input.actorUserId,
			});
		}

		return comment;
	}

	public async bulkUpdateComments(input: {
		commentIds: string[];
		patch: {
			status?: CommentStatus;
			isPinned?: boolean;
			isFolded?: boolean;
			contentRaw?: string;
		};
		requestId?: string;
		actorUserId?: number;
	}) {
		const comments = await this.repository.bulkUpdateComments(
			input.commentIds,
			input.patch,
		);

		await this.security.writeAudit({
			requestId: input.requestId,
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			event: input.patch.status
				? "comments.status.changed"
				: "comments.updated",
			message: "批量更新评论",
			targetType: "comment",
			targetId: comments.map((comment) => comment.id).join(","),
			payload: {
				commentIds: comments.map((comment) => comment.id),
				patch: input.patch,
			},
		});
		if (input.patch.status === "approved") {
			for (const comment of comments) {
				if (!comment.parentId) {
					continue;
				}
				await this.planReplyNotification({
					commentId: comment.id,
					source: "admin_moderation",
					requestId: input.requestId,
					actorUserId: input.actorUserId,
				});
			}
		}

		return {
			comments,
			updatedCount: comments.length,
		};
	}

	public async refreshCommentMetadata(input: {
		commentId: string;
		requestId?: string;
		actorUserId?: number;
	}) {
		const commentId = input.commentId;
		const comment = await this.repository.getCommentById(commentId);
		if (!comment || comment.deletedAt) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}
		const metadata = await this.repository.getCommentRequestMetadata(commentId);
		if (!metadata?.authorIp) {
			throw new AppError(
				400,
				"COMMENT_IP_METADATA_NOT_FOUND",
				"评论没有可刷新的 IP 数据。",
			);
		}

		const systemSettings = new RuntimeSystemSettingsService(
			this.repository.database,
		);
		const resolver = new DefaultCommentMetadataResolver();
		try {
			const snapshot = await resolver.resolve({
				ip: metadata.authorIp,
				metadata: defaultCommentMetadata,
				ipRegion: await systemSettings.getIpRegionSettings(),
			});
			const refreshed = await this.repository.updateCommentIpLocation(
				commentId,
				{
					country: snapshot.authorIpCountry,
					region: snapshot.authorIpRegion,
					city: snapshot.authorIpCity,
					isp: snapshot.authorIpIsp,
					raw: snapshot.authorIpLocationRaw,
					source: snapshot.authorIpLocationSource,
					dbHash: snapshot.authorIpLocationDbHash,
					error: snapshot.authorIpLocationError,
				},
			);
			if (!refreshed) {
				throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
			}

			await this.security.writeAudit({
				requestId: input.requestId,
				actorType: input.actorUserId ? "admin_user" : "system",
				actorId: input.actorUserId ? String(input.actorUserId) : undefined,
				event: "comments.updated",
				message: "评论地址信息已刷新",
				targetType: "comment",
				targetId: commentId,
			});

			return refreshed;
		} finally {
			resolver.close();
		}
	}

	public async bulkRefreshCommentMetadata(
		commentIds: string[],
		requestId?: string,
		actorUserId?: number,
	) {
		const items = [];
		for (const commentId of commentIds) {
			try {
				items.push(
					await this.refreshCommentMetadata({
						commentId,
						requestId,
						actorUserId,
					}),
				);
			} catch (error) {
				items.push({
					commentId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return {
			refreshedCount: items.filter((item) => !("error" in item)).length,
			failedCount: items.filter((item) => "error" in item).length,
			items,
		};
	}

	public async deleteComment(input: {
		commentId: string;
		requestId?: string;
		actorUserId?: number;
	}) {
		const commentId = input.commentId;
		const existingComment = await this.repository.getCommentById(commentId);
		if (!existingComment || existingComment.deletedAt) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}
		if (existingComment.status !== "trash") {
			throw new AppError(
				400,
				"COMMENT_NOT_IN_TRASH",
				"评论需要先移入回收站，才能永久删除。",
			);
		}

		const comment = await this.repository.permanentlyDeleteComment(commentId);
		if (!comment) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}

		await this.security.writeAudit({
			requestId: input.requestId,
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			event: "comments.deleted",
			message: "评论已删除",
			targetType: "comment",
			targetId: commentId,
		});

		return comment;
	}

	public async moveCommentsToTrash(input: {
		commentIds: string[];
		requestId?: string;
		actorUserId?: number;
	}) {
		const movedComments = await this.repository.moveCommentsToTrash(
			input.commentIds,
		);

		await this.security.writeAudit({
			requestId: input.requestId,
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			event: "comments.status.changed",
			message: "评论已移入回收站",
			targetType: "comment",
			targetId: movedComments.map((comment) => comment.id).join(","),
			payload: {
				commentIds: movedComments.map((comment) => comment.id),
				status: "trash",
			},
		});

		return {
			comments: movedComments,
			updatedCount: movedComments.length,
		};
	}

	public async clearTrash(input: {
		siteKey?: string;
		requestId?: string;
		actorUserId?: number;
	}) {
		const siteId = await this.resolveSiteId(input.siteKey);
		const deletedCount = await this.repository.clearTrash(siteId);

		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey: input.siteKey,
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			event: "comments.deleted",
			message: "回收站已清空",
			targetType: "comment",
			targetId: input.siteKey ?? "all",
			payload: {
				deletedCount,
			},
		});

		return {
			deletedCount,
		};
	}

	public async replyToComment(
		parentCommentId: string,
		input: {
			contentRaw: string;
			requestId?: string;
			actorUserId?: number;
		},
	) {
		const context =
			await this.repository.getCommentReplyContext(parentCommentId);
		if (!context) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}

		const verifiedAuthor = mergeVerifiedAuthorSettings(
			context.verifiedAuthorJson,
		);
		if (!verifiedAuthor.enabled) {
			throw new AppError(
				400,
				"VERIFIED_AUTHOR_DISABLED",
				"可信评论作者未启用。",
			);
		}

		const writeRepository = new CommentsWriteRepository(
			this.repository.database,
		);
		const created = await writeRepository.createComment({
			siteId: context.siteId,
			pageThreadId: context.pageThreadId,
			parentCommentId,
			visitorId: null,
			authorIdentity: "verified",
			authorName: verifiedAuthor.displayName,
			authorEmail: verifiedAuthor.email || undefined,
			authorWebsite: verifiedAuthor.website || undefined,
			contentRaw: input.contentRaw,
			status: "approved",
		});
		const comment = await this.repository.getCommentById(created.commentId);
		if (!comment) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}

		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey: context.siteKey,
			pageKey: context.pageKey,
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			event: "comments.created",
			message: "管理员已回复评论",
			targetType: "comment",
			targetId: created.commentId,
			payload: {
				parentCommentId,
				status: "approved",
			},
		});
		await this.planReplyNotification({
			commentId: created.commentId,
			source: "admin_reply",
			requestId: input.requestId,
			actorUserId: input.actorUserId,
		});

		const [presentedComment] = presentComments(
			[
				{
					...comment,
					parentId: null,
				},
			],
			new Map(),
			{
				verifiedAuthor: {
					enabled: verifiedAuthor.enabled,
					displayName: verifiedAuthor.displayName,
					badgeLabel: verifiedAuthor.badgeLabel,
				},
				staffDisplay: mergeStaffDisplaySettings(context.staffDisplayJson),
			},
		);
		if (presentedComment) {
			presentedComment.parentId = comment.parentId;
		}

		return {
			comment: presentedComment,
		};
	}

	private async planReplyNotification(input: {
		commentId: string;
		source: "admin_moderation" | "admin_reply";
		requestId?: string;
		actorUserId?: number;
	}) {
		try {
			const context = await this.repository.getCommentReplyContext(
				input.commentId,
			);
			if (!context) {
				return;
			}
			await new CommentNotificationPlanner(
				this.repository.database,
			).planForCommentEvent({
				siteId: context.siteId,
				siteKey: context.siteKey,
				pageKey: context.pageKey,
				commentId: input.commentId,
				source: input.source,
				actorType: input.actorUserId ? "admin_user" : "system",
				actorId: input.actorUserId ? String(input.actorUserId) : "system",
			});
		} catch (error) {
			await this.security
				.writeAudit({
					requestId: input.requestId,
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

	public async listBlacklist(input: {
		siteKey?: string;
		search?: string;
		limit: number;
		offset: number;
	}) {
		const siteId = await this.resolveSiteId(input.siteKey);
		const result = await this.repository.listBlacklist({
			siteId,
			search: input.search,
			limit: input.limit,
			offset: input.offset,
		});

		return buildPaginationResult(result.items, {
			limit: input.limit,
			offset: input.offset,
			totalCount: result.totalCount,
		});
	}

	public async createBlacklist(input: {
		siteKey?: string;
		targetType: "ip" | "email" | "visitor";
		matchMode: "exact" | "cidr" | "wildcard";
		targetValue: string;
		scope: "post" | "all";
		reason?: string;
		expiresAt?: string;
		requestId?: string;
		actorUserId?: number;
	}) {
		const siteId = await this.resolveSiteId(input.siteKey);
		const rule = await this.repository.createBlacklistRule({
			siteId,
			scope: input.scope,
			targetType: input.targetType,
			matchMode: input.matchMode,
			targetValue: input.targetValue,
			reason: input.reason,
			expiresAt: input.expiresAt,
		});

		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey: input.siteKey,
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			event: "security.blacklist.added",
			message: "已新增黑名单规则",
			targetType: input.targetType,
			targetId: input.targetValue,
			payload: {
				ruleId: rule?.id,
				scope: input.scope,
			},
		});

		return rule;
	}

	public async deleteBlacklist(input: {
		ruleId: number;
		requestId?: string;
		actorUserId?: number;
	}) {
		const rule = await this.repository.deleteBlacklistRule(input.ruleId);
		if (!rule) {
			throw new ResourceNotFoundError(
				"BLACKLIST_RULE_NOT_FOUND",
				"黑名单规则不存在。",
			);
		}

		await this.security.writeAudit({
			requestId: input.requestId,
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			action: "blacklist.deleted",
			targetType: "blacklist_rule",
			targetId: String(input.ruleId),
		});

		return rule;
	}

	public async deleteBlacklistTarget(input: {
		siteKey?: string;
		targetType: "ip" | "email" | "visitor";
		matchMode: "exact" | "cidr" | "wildcard";
		targetValue: string;
		requestId?: string;
		actorUserId?: number;
	}) {
		const siteId = await this.resolveSiteId(input.siteKey);
		const rules = await this.repository.deleteBlacklistRulesByTarget({
			siteId,
			targetType: input.targetType,
			matchMode: input.matchMode,
			targetValue: input.targetValue,
		});
		if (rules.length === 0) {
			throw new ResourceNotFoundError(
				"BLACKLIST_RULE_NOT_FOUND",
				"黑名单规则不存在。",
			);
		}

		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey: input.siteKey,
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			event: "security.blacklist.deleted",
			message: "已删除黑名单规则",
			targetType: input.targetType,
			targetId: input.targetValue,
			payload: {
				ruleIds: rules.map((rule) => rule.id),
				matchMode: input.matchMode,
			},
		});

		return rules;
	}

	public async getSettings(siteKey: string) {
		const { registeredSite } = this.resolveSite(siteKey);
		const settings = await this.repository.getSiteSettings(registeredSite.id);
		if (!settings) {
			throw new ResourceNotFoundError("SETTINGS_NOT_FOUND", "站点设置不存在。");
		}
		const recipients = await this.repository.listSiteNotificationRecipients(
			registeredSite.id,
		);
		const channelConfigs =
			await this.repository.listNotificationChannelConfigs();

		return {
			siteKey,
			comments: {
				enabled: settings.commentsEnabled,
				defaultStatus: settings.defaultStatus,
				maxDepth: settings.maxDepth,
				rootLimit: settings.rootLimit,
				identity: buildCommentForm({
					allowWebsite: settings.allowWebsite,
					commentRequireJson: settings.commentRequireJson,
				}),
				allowWebsite: settings.allowWebsite,
				captcha: {
					mode: settings.captchaMode,
					thresholdWindowSec: settings.captchaThresholdWindowSec,
					thresholdMaxActions: settings.captchaThresholdMaxActions,
				},
				abuseGuard: {
					enabled: settings.abuseGuardEnabled,
					windowSec: settings.abuseGuardWindowSec,
					maxWriteActions: settings.abuseGuardMaxWriteActions,
					autoBlacklist: {
						enabled: settings.autoBlacklistEnabled,
						scope: settings.autoBlacklistScope as "post" | "all",
						ttlSec: settings.autoBlacklistTtlSec,
					},
				},
				metadata: mergeCommentMetadata(settings.commentMetadataJson),
				verifiedAuthor: mergeVerifiedAuthorSettings(
					settings.verifiedAuthorJson,
				),
				staffDisplay: mergeStaffDisplaySettings(settings.staffDisplayJson),
				moderation: mergeSiteModerationSettings(
					settings.moderationJson,
					settings.defaultStatus as "pending" | "approved",
				),
			},
			pageFeedback: {
				allowLike: settings.allowPageLike,
			},
			engagement: mergeEngagementSettings(settings.engagementJson),
			notifications: {
				emailEnabled: settings.emailNotificationsEnabled,
				channelConfigs,
				recipients: recipients.map((recipient) => ({
					id: recipient.id,
					userId: recipient.userId,
					username: recipient.username,
					email: recipient.email,
					displayName: recipient.displayName,
					channels: recipient.channels,
					events: recipient.events,
					routes: recipient.routes.map((route) => ({
						id: route.id,
						eventType: route.eventType,
						channelConfigId: route.channelConfigId,
						channelType: route.channelType,
						channelName: route.channelName,
						enabled: route.enabled,
					})),
					includeCommentContent: recipient.includeCommentContent,
					rateLimitProfile: recipient.rateLimitProfile,
					enabled: recipient.enabled,
				})),
			},
		};
	}

	private async validateNotificationRecipients(input: {
		siteId: number;
		recipients?: NotificationRecipientInput[];
	}) {
		if (!input.recipients) {
			return;
		}
		const seenUserIds = new Set<number>();
		for (const recipient of input.recipients) {
			if (seenUserIds.has(recipient.userId)) {
				throw new AppError(
					400,
					"ADMIN_NOTIFICATION_RECIPIENT_DUPLICATE",
					"通知接收人不能重复。",
				);
			}
			seenUserIds.add(recipient.userId);
			const candidate = await this.repository.getNotificationRecipientCandidate(
				{
					siteId: input.siteId,
					userId: recipient.userId,
				},
			);
			if (!candidate) {
				throw new ResourceNotFoundError("ADMIN_USER_NOT_FOUND", "用户不存在。");
			}
			if (candidate.status !== "active" || candidate.deletedAt) {
				throw new AppError(
					400,
					"ADMIN_NOTIFICATION_RECIPIENT_INACTIVE",
					"通知接收人必须是启用状态的后台用户。",
				);
			}
			if (!candidate.siteAccessId) {
				throw new AppError(
					403,
					"ADMIN_NOTIFICATION_RECIPIENT_SITE_ACCESS_REQUIRED",
					"通知接收人必须拥有目标站点权限。",
				);
			}
		}
	}

	public async updateSettings(
		siteKey: string,
		input: {
			comments?: {
				enabled?: boolean;
				defaultStatus?: "pending" | "approved";
				maxDepth?: number;
				rootLimit?: number;
				identity?: {
					require?: Array<"nickname" | "email" | "website">;
				};
				allowWebsite?: boolean;
				captcha?: {
					mode?: "never" | "always" | "threshold";
					thresholdWindowSec?: number;
					thresholdMaxActions?: number;
				};
				abuseGuard?: {
					enabled?: boolean;
					windowSec?: number;
					maxWriteActions?: number;
					autoBlacklist?: {
						enabled?: boolean;
						scope?: "post" | "all";
						ttlSec?: number;
					};
				};
				metadata?: CommentMetadataPatch;
				verifiedAuthor?: VerifiedAuthorSettings;
				staffDisplay?: StaffDisplaySettings;
				moderation?: SiteModerationSettings;
			};
			pageFeedback?: {
				allowLike?: boolean;
			};
			engagement?: EngagementSettingsPatch;
			notifications?: {
				emailEnabled?: boolean;
				recipients?: NotificationRecipientInput[];
			};
			requestId?: string;
			actorUserId?: number;
		},
	) {
		const { registeredSite } = this.resolveSite(siteKey);
		const existingSettings = await this.repository.getSiteSettings(
			registeredSite.id,
		);
		if (!existingSettings) {
			throw new ResourceNotFoundError("SETTINGS_NOT_FOUND", "站点设置不存在。");
		}
		const currentEngagement = mergeEngagementSettings(
			existingSettings.engagementJson,
		);
		const nextEngagement = input.engagement
			? mergeEngagementSettingsPatch(currentEngagement, input.engagement)
			: undefined;
		await this.validateNotificationRecipients({
			siteId: registeredSite.id,
			recipients: input.notifications?.recipients,
		});

		await this.repository.updateSiteSettings(registeredSite.id, {
			commentsEnabled: input.comments?.enabled,
			defaultStatus: input.comments?.defaultStatus,
			maxDepth: input.comments?.maxDepth,
			rootLimit: input.comments?.rootLimit,
			commentRequireJson: input.comments?.identity?.require
				? JSON.stringify(input.comments.identity.require)
				: undefined,
			allowWebsite: input.comments?.allowWebsite,
			allowPageLike:
				nextEngagement?.pageLikes.enabled ?? input.pageFeedback?.allowLike,
			captchaMode: input.comments?.captcha?.mode,
			captchaThresholdWindowSec: input.comments?.captcha?.thresholdWindowSec,
			captchaThresholdMaxActions: input.comments?.captcha?.thresholdMaxActions,
			abuseGuardEnabled: input.comments?.abuseGuard?.enabled,
			abuseGuardWindowSec: input.comments?.abuseGuard?.windowSec,
			abuseGuardMaxWriteActions: input.comments?.abuseGuard?.maxWriteActions,
			autoBlacklistEnabled: input.comments?.abuseGuard?.autoBlacklist?.enabled,
			autoBlacklistScope: input.comments?.abuseGuard?.autoBlacklist?.scope,
			autoBlacklistTtlSec: input.comments?.abuseGuard?.autoBlacklist?.ttlSec,
			commentMetadataJson: input.comments?.metadata
				? JSON.stringify(input.comments.metadata)
				: undefined,
			verifiedAuthorJson: input.comments?.verifiedAuthor
				? serializeVerifiedAuthorSettings({
						...input.comments.verifiedAuthor,
						website:
							sanitizeOptionalSafeHttpUrl(
								input.comments.verifiedAuthor.website,
							) ?? "",
					})
				: undefined,
			staffDisplayJson: input.comments?.staffDisplay
				? serializeStaffDisplaySettings(input.comments.staffDisplay)
				: undefined,
			moderationJson: input.comments?.moderation
				? serializeSiteModerationSettings(input.comments.moderation)
				: undefined,
			engagementJson: nextEngagement
				? serializeEngagementSettings(nextEngagement)
				: undefined,
			emailNotificationsEnabled: input.notifications?.emailEnabled,
		});
		if (input.notifications?.recipients) {
			await this.repository.replaceSiteNotificationRecipients({
				siteId: registeredSite.id,
				recipients: input.notifications.recipients,
			});
		}

		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey,
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			event: "settings.updated",
			message: "站点设置已更新",
			targetType: "site_settings",
			targetId: String(registeredSite.id),
			payload: {
				comments: input.comments,
				pageFeedback: input.pageFeedback,
				engagement: input.engagement,
				notifications: input.notifications,
			},
		});

		return this.getSettings(siteKey);
	}
}
