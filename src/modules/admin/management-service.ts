import { ResourceNotFoundError } from "../shared/errors";
import type { SecurityToolkit } from "../../plugins/security";
import { buildCommentForm } from "../comments/comment-form";
import type { SiteRegistry } from "../shared/site-registry";
import type { AdminRepository } from "./repository";

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

	public async listComments(input: {
		siteKey?: string;
		pageKey?: string;
		status?: "pending" | "approved";
		search?: string;
		limit: number;
		offset: number;
	}) {
		const siteId = await this.resolveSiteId(input.siteKey);
		const result = await this.repository.listComments({
			siteId,
			pageKey: input.pageKey,
			status: input.status,
			search: input.search,
			limit: input.limit,
			offset: input.offset,
		});

		return {
			items: result.items,
			pagination: {
				limit: input.limit,
				offset: input.offset,
				totalCount: result.totalCount,
			},
		};
	}

	public async listPages(input: {
		siteKey?: string;
		search?: string;
		limit: number;
		offset: number;
	}) {
		const siteId = await this.resolveSiteId(input.siteKey);
		const result = await this.repository.listPages({
			siteId,
			search: input.search,
			limit: input.limit,
			offset: input.offset,
		});

		return {
			items: result.items,
			pagination: {
				limit: input.limit,
				offset: input.offset,
				totalCount: result.totalCount,
			},
		};
	}

	public async listUsers(input: {
		siteKey?: string;
		search?: string;
		limit: number;
		offset: number;
	}) {
		const siteId = await this.resolveSiteId(input.siteKey);
		const result = await this.repository.listUsers({
			siteId,
			search: input.search,
			limit: input.limit,
			offset: input.offset,
		});

		return {
			items: result.items,
			pagination: {
				limit: input.limit,
				offset: input.offset,
				totalCount: result.totalCount,
			},
		};
	}

	public async listVisitors(input: {
		siteKey?: string;
		search?: string;
		limit: number;
		offset: number;
	}) {
		const siteId = await this.resolveSiteId(input.siteKey);
		const result = await this.repository.listVisitors({
			siteId,
			search: input.search,
			limit: input.limit,
			offset: input.offset,
		});

		return {
			items: result.items,
			pagination: {
				limit: input.limit,
				offset: input.offset,
				totalCount: result.totalCount,
			},
		};
	}

	public async listSitesSummary() {
		const items = await this.repository.listSitesSummary();

		return {
			items: items.map((item) => {
				const configuredSite = this.siteRegistry.getConfiguredSite(
					item.siteKey,
				);
				if (!configuredSite) {
					throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
				}

				return {
					siteKey: item.siteKey,
					name: item.name,
					allowedOrigins: item.allowedOrigins,
					comments: {
						enabled: item.comments.enabled,
						defaultStatus: item.comments.defaultStatus,
						identity: buildCommentForm(configuredSite, {
							allowWebsite: item.comments.allowWebsite,
							commentRequireJson: item.comments.commentRequireJson,
						}),
						allowWebsite: item.comments.allowWebsite,
						captcha: item.comments.captcha,
					},
					pageFeedback: item.pageFeedback,
					notifications: item.notifications,
					pageCount: item.pageCount,
					commentCount: item.commentCount,
					userCount: item.userCount,
					visitorCount: item.visitorCount,
				};
			}),
		};
	}

	public async updateComment(
		commentId: string,
		input: {
			status?: "pending" | "approved";
			isPinned?: boolean;
			isFolded?: boolean;
			contentRaw?: string;
		},
	) {
		const comment = await this.repository.updateComment(commentId, input);
		if (!comment) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}

		await this.security.writeAudit({
			actorType: "admin",
			action: "comment.updated",
			targetType: "comment",
			targetId: commentId,
		});

		return comment;
	}

	public async deleteComment(commentId: string) {
		const comment = await this.repository.softDeleteComment(commentId);
		if (!comment) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}

		await this.security.writeAudit({
			actorType: "admin",
			action: "comment.deleted",
			targetType: "comment",
			targetId: commentId,
		});

		return comment;
	}

	public async listBlacklist(siteKey?: string) {
		const siteId = await this.resolveSiteId(siteKey);
		return this.repository.listBlacklist(siteId);
	}

	public async createBlacklist(input: {
		siteKey?: string;
		targetType: "ip" | "email" | "visitor";
		matchMode: "exact" | "cidr" | "wildcard";
		targetValue: string;
		scope: "post" | "all";
		reason?: string;
		expiresAt?: string;
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
			siteKey: input.siteKey,
			actorType: "admin",
			action: "blacklist.created",
			targetType: "blacklist_rule",
			targetId: String(rule?.id),
		});

		return rule;
	}

	public async deleteBlacklist(ruleId: number) {
		const rule = await this.repository.deleteBlacklistRule(ruleId);
		if (!rule) {
			throw new ResourceNotFoundError(
				"BLACKLIST_RULE_NOT_FOUND",
				"黑名单规则不存在。",
			);
		}

		await this.security.writeAudit({
			actorType: "admin",
			action: "blacklist.deleted",
			targetType: "blacklist_rule",
			targetId: String(ruleId),
		});

		return rule;
	}

	public async getSettings(siteKey: string) {
		const siteId = await this.resolveSiteId(siteKey);
		const configuredSite = this.siteRegistry.getConfiguredSite(siteKey);
		if (!siteId) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}
		if (!configuredSite) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const settings = await this.repository.getRuntimeSettings(siteId);
		if (!settings) {
			throw new ResourceNotFoundError("SETTINGS_NOT_FOUND", "运行设置不存在。");
		}

		return {
			siteKey,
			comments: {
				enabled: settings.commentsEnabled,
				defaultStatus: settings.defaultStatus,
				maxDepth: settings.maxDepth,
				rootLimit: settings.rootLimit,
				identity: buildCommentForm(configuredSite, {
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
			},
			pageFeedback: {
				allowLike: settings.allowPageLike,
			},
			notifications: {
				emailEnabled: settings.emailNotificationsEnabled,
			},
		};
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
			};
			pageFeedback?: {
				allowLike?: boolean;
			};
			notifications?: {
				emailEnabled?: boolean;
			};
		},
	) {
		const siteId = await this.resolveSiteId(siteKey);
		if (!siteId) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		await this.repository.updateRuntimeSettings(siteId, {
			commentsEnabled: input.comments?.enabled,
			defaultStatus: input.comments?.defaultStatus,
			maxDepth: input.comments?.maxDepth,
			rootLimit: input.comments?.rootLimit,
			commentRequireJson: input.comments?.identity?.require
				? JSON.stringify(input.comments.identity.require)
				: undefined,
			allowWebsite: input.comments?.allowWebsite,
			allowPageLike: input.pageFeedback?.allowLike,
			captchaMode: input.comments?.captcha?.mode,
			captchaThresholdWindowSec: input.comments?.captcha?.thresholdWindowSec,
			captchaThresholdMaxActions: input.comments?.captcha?.thresholdMaxActions,
			abuseGuardEnabled: input.comments?.abuseGuard?.enabled,
			abuseGuardWindowSec: input.comments?.abuseGuard?.windowSec,
			abuseGuardMaxWriteActions: input.comments?.abuseGuard?.maxWriteActions,
			autoBlacklistEnabled: input.comments?.abuseGuard?.autoBlacklist?.enabled,
			autoBlacklistScope: input.comments?.abuseGuard?.autoBlacklist?.scope,
			autoBlacklistTtlSec: input.comments?.abuseGuard?.autoBlacklist?.ttlSec,
			emailNotificationsEnabled: input.notifications?.emailEnabled,
		});

		await this.security.writeAudit({
			siteKey,
			actorType: "admin",
			action: "settings.updated",
			targetType: "runtime_settings",
			targetId: String(siteId),
		});

		return this.getSettings(siteKey);
	}
}
