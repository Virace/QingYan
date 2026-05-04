import type { SiteConfig } from "../../config/types";
import type { SecurityToolkit } from "../../plugins/security";
import { InvalidRequestError, ResourceNotFoundError } from "../shared/errors";
import { buildCommentForm } from "../comments/comment-form";
import { buildRuntimeSettingsDefaults } from "../shared/runtime-settings-defaults";
import type { SiteRegistry } from "../shared/site-registry";
import type { AdminRepository } from "./repository";

type CommentMetadataSettings = SiteConfig["defaults"]["comments"]["metadata"];
type CommentMetadataPatch = {
	collectIp?: boolean;
	collectUserAgent?: boolean;
	ipRegion?: {
		enabled?: boolean;
		cachePolicy?: "file" | "vectorIndex" | "content";
		precision?: "country" | "province" | "city";
		autoUpdate?: {
			enabled?: boolean;
			schedule?: "monthly";
		};
		ipv4?: {
			dbPath?: string;
			sources?: string[];
		};
		ipv6?: {
			dbPath?: string;
			sources?: string[];
		};
	};
	device?: {
		enabled?: boolean;
		display?: {
			enabled?: boolean;
		};
	};
};

function mergeCommentMetadata(
	defaults: CommentMetadataSettings,
	payload?: string | null,
): CommentMetadataSettings {
	if (!payload) {
		return defaults;
	}

	try {
		const parsed = JSON.parse(payload) as CommentMetadataPatch;
		return {
			...defaults,
			...parsed,
			ipRegion: {
				...defaults.ipRegion,
				...parsed.ipRegion,
				autoUpdate: {
					...defaults.ipRegion.autoUpdate,
					...parsed.ipRegion?.autoUpdate,
				},
				ipv4: {
					...defaults.ipRegion.ipv4,
					...parsed.ipRegion?.ipv4,
				},
				ipv6: {
					...defaults.ipRegion.ipv6,
					...parsed.ipRegion?.ipv6,
				},
			},
			device: {
				...defaults.device,
				...parsed.device,
				display: {
					...defaults.device.display,
					...parsed.device?.display,
				},
			},
		};
	} catch {
		return defaults;
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

		const configuredSite = this.siteRegistry.getConfiguredSite(siteKey);
		if (!configuredSite) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		return {
			registeredSite,
			configuredSite,
		};
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
			items: items.flatMap((item) => {
				const configuredSite = this.siteRegistry.getConfiguredSite(
					item.siteKey,
				);
				const registeredSite = this.siteRegistry.getRegisteredSite(
					item.siteKey,
				);
				if (!configuredSite) {
					return [];
				}
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
	}) {
		const existingSite = await this.repository.getSiteByKey(input.siteKey);
		if (existingSite) {
			throw new InvalidRequestError({
				code: "SITE_KEY_EXISTS",
				message: "站点标识已存在。",
			});
		}

		const template = this.siteRegistry.getDefaultSiteTemplate();
		const site = await this.repository.createSite({
			siteKey: input.siteKey,
			name: input.name,
			allowedOrigins: input.allowedOrigins,
			defaults: template.defaults,
		});
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		await this.siteRegistry.sync(this.repository.database);
		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey: input.siteKey,
			actorType: "admin",
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
			status?: "pending" | "approved";
			isPinned?: boolean;
			isFolded?: boolean;
			contentRaw?: string;
			requestId?: string;
		},
	) {
		const comment = await this.repository.updateComment(commentId, input);
		if (!comment) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}

		await this.security.writeAudit({
			requestId: input.requestId,
			actorType: "admin",
			event: input.status ? "comments.status.changed" : "comments.updated",
			message: input.status ? "评论状态已更新" : "评论内容已更新",
			targetType: "comment",
			targetId: commentId,
		});

		return comment;
	}

	public async deleteComment(commentId: string, requestId?: string) {
		const comment = await this.repository.softDeleteComment(commentId);
		if (!comment) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}

		await this.security.writeAudit({
			requestId,
			actorType: "admin",
			event: "comments.deleted",
			message: "评论已删除",
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
		requestId?: string;
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
			actorType: "admin",
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

	public async deleteBlacklist(ruleId: number, requestId?: string) {
		const rule = await this.repository.deleteBlacklistRule(ruleId);
		if (!rule) {
			throw new ResourceNotFoundError(
				"BLACKLIST_RULE_NOT_FOUND",
				"黑名单规则不存在。",
			);
		}

		await this.security.writeAudit({
			requestId,
			actorType: "admin",
			action: "blacklist.deleted",
			targetType: "blacklist_rule",
			targetId: String(ruleId),
		});

		return rule;
	}

	public async deleteBlacklistTarget(input: {
		siteKey?: string;
		targetType: "ip" | "email" | "visitor";
		matchMode: "exact" | "cidr" | "wildcard";
		targetValue: string;
		requestId?: string;
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
			actorType: "admin",
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
		const { registeredSite, configuredSite } = this.resolveSite(siteKey);
		const settings = registeredSite.runtimeOnly
			? buildRuntimeSettingsDefaults(registeredSite.id, configuredSite)
			: await this.repository.getRuntimeSettings(registeredSite.id);
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
				metadata: mergeCommentMetadata(
					configuredSite.defaults.comments.metadata,
					settings.commentMetadataJson,
				),
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
				metadata?: CommentMetadataPatch;
			};
			pageFeedback?: {
				allowLike?: boolean;
			};
			notifications?: {
				emailEnabled?: boolean;
			};
			requestId?: string;
		},
	) {
		const { registeredSite } = this.resolveSite(siteKey);
		if (registeredSite.runtimeOnly) {
			throw new ResourceNotFoundError(
				"SETTINGS_NOT_PERSISTED",
				"开发模式默认站点不支持持久化运行时设置。",
			);
		}

		await this.repository.updateRuntimeSettings(registeredSite.id, {
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
			commentMetadataJson: input.comments?.metadata
				? JSON.stringify(input.comments.metadata)
				: undefined,
			emailNotificationsEnabled: input.notifications?.emailEnabled,
		});

		await this.security.writeAudit({
			requestId: input.requestId,
			siteKey,
			actorType: "admin",
			event: "settings.updated",
			message: "站点运行时设置已更新",
			targetType: "runtime_settings",
			targetId: String(registeredSite.id),
			payload: {
				comments: input.comments,
				pageFeedback: input.pageFeedback,
				notifications: input.notifications,
			},
		});

		return this.getSettings(siteKey);
	}
}
