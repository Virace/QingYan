import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";

import type { DatabaseExecutor } from "../../db/client";
import {
	adminSessions,
	allowlistRules,
	blacklistRules,
	commenterNotificationPreferences,
	commentRequestMetadata,
	commentReviewEvents,
	comments,
	emailDeliveryReputation,
	pageThreads,
	pageViewSessions,
	sitePageRegistry,
	siteSettings,
	sites,
	visitorRequestMetadata,
	visitors,
} from "../../db/schema";
import { enqueueCommentNotificationIntent } from "../notifications/comment-notification-intent";
import { requireCommentAccount } from "../comments/account-identity";
import { AbuseRepository } from "../comments/abuse-repository";
import { buildExternalAvatarUrl } from "../comments/gravatar";
import type { CommentStatus } from "../comments/moderation-types";
import { NotificationChannelConfigsRepository } from "../notifications/channel-configs-repository";
import {
	type SiteNotificationEventInput,
	SiteNotificationEventsRepository,
} from "../notifications/site-notification-events-repository";
import { matchBlacklistRule } from "../shared/blacklist-match";
import { hashCommentEmail, renderCommentHtml } from "../shared/comment-content";
import { resolvePublicPageUrl } from "../shared/page-url";
import {
	buildDefaultSiteSettings,
	type EngagementSettings,
	mergeEngagementSettings,
} from "../shared/site-settings-defaults";
import type { SystemSettings } from "../system-settings/definitions";

function parseStringArray(payload?: string | null): string[] {
	if (!payload) {
		return [];
	}

	try {
		const parsed = JSON.parse(payload) as unknown;
		return Array.isArray(parsed)
			? parsed.filter(
					(item): item is string => typeof item === "string" && item.length > 0,
				)
			: [];
	} catch {
		return [];
	}
}

function toCountMap<T extends number | null | undefined>(
	rows: Array<{ key: number | null; value: T }>,
): Map<number, number> {
	const map = new Map<number, number>();

	for (const row of rows) {
		if (row.key === null) {
			continue;
		}

		map.set(row.key, Number(row.value ?? 0));
	}

	return map;
}

function majorVersion(version?: string | null): string | null {
	return version?.split(".")[0] || null;
}

function formatIpLocationLabel(input: {
	country?: string | null;
	region?: string | null;
	city?: string | null;
	error?: string | null;
}): string {
	if (input.error) {
		return "解析失败";
	}

	return (
		[input.country, input.region, input.city].filter(Boolean).join(" / ") ||
		"未知地区"
	);
}

function formatDeviceLabel(input: {
	browser?: string | null;
	browserVersion?: string | null;
	os?: string | null;
	osVersion?: string | null;
	type?: string | null;
	error?: string | null;
}): string {
	if (input.error) {
		return "解析失败";
	}

	const browser =
		input.browser && input.browser !== "unknown"
			? [input.browser, majorVersion(input.browserVersion)]
					.filter(Boolean)
					.join(" ")
			: null;
	const os =
		input.os && input.os !== "unknown"
			? [input.os, majorVersion(input.osVersion)].filter(Boolean).join(" ")
			: null;
	const type = input.type && input.type !== "unknown" ? input.type : null;

	return [browser, os, type].filter(Boolean).join(" / ") || "未知设备";
}

function buildRequestMeta(input: {
	ip?: string | null;
	userAgent?: string | null;
	ipCountry?: string | null;
	ipRegion?: string | null;
	ipCity?: string | null;
	ipIsp?: string | null;
	ipLocationSource?: string | null;
	ipLocationUpdatedAt?: string | null;
	ipLocationError?: string | null;
	deviceBrowser?: string | null;
	deviceBrowserVersion?: string | null;
	deviceOs?: string | null;
	deviceOsVersion?: string | null;
	deviceType?: string | null;
	deviceIcon?: string | null;
	deviceSource?: string | null;
	deviceUpdatedAt?: string | null;
	deviceError?: string | null;
}) {
	const hasLocation =
		Boolean(input.ipCountry || input.ipRegion || input.ipCity || input.ipIsp) ||
		Boolean(input.ipLocationSource || input.ipLocationUpdatedAt) ||
		Boolean(input.ipLocationError);
	const hasDevice = Boolean(
		input.deviceBrowser ||
			input.deviceBrowserVersion ||
			input.deviceOs ||
			input.deviceOsVersion ||
			input.deviceType ||
			input.deviceIcon ||
			input.deviceSource ||
			input.deviceUpdatedAt ||
			input.deviceError,
	);

	return {
		ip: {
			raw: input.ip ?? null,
			location: hasLocation
				? {
						label: formatIpLocationLabel({
							country: input.ipCountry,
							region: input.ipRegion,
							city: input.ipCity,
							error: input.ipLocationError,
						}),
						country: input.ipCountry ?? null,
						region: input.ipRegion ?? null,
						city: input.ipCity ?? null,
						isp: input.ipIsp ?? null,
						source: input.ipLocationSource ?? null,
						updatedAt: input.ipLocationUpdatedAt ?? null,
						error: input.ipLocationError ?? null,
					}
				: null,
		},
		userAgent: {
			raw: input.userAgent ?? null,
			device: hasDevice
				? {
						label: formatDeviceLabel({
							browser: input.deviceBrowser,
							browserVersion: input.deviceBrowserVersion,
							os: input.deviceOs,
							osVersion: input.deviceOsVersion,
							type: input.deviceType,
							error: input.deviceError,
						}),
						browser: input.deviceBrowser ?? "unknown",
						browserVersion: input.deviceBrowserVersion ?? null,
						os: input.deviceOs ?? "unknown",
						osVersion: input.deviceOsVersion ?? null,
						type: input.deviceType ?? "unknown",
						icon: input.deviceIcon ?? null,
						source: input.deviceSource ?? null,
						updatedAt: input.deviceUpdatedAt ?? null,
						error: input.deviceError ?? null,
					}
				: null,
		},
	};
}

type RequestMetaSource = Parameters<typeof buildRequestMeta>[0];
type RequestMetaAggregateSource = RequestMetaSource & { count?: number };

interface RequestMetaAggregate {
	key: string;
	label: string;
	count: number;
	distinctIpCount?: number;
}

function locationKey(input: RequestMetaSource): string {
	return [input.ipCountry, input.ipRegion, input.ipCity]
		.map((value) => value ?? "")
		.join("|");
}

function deviceKey(input: RequestMetaSource): string {
	return [input.deviceBrowser, input.deviceOs, input.deviceType]
		.map((value) => value ?? "unknown")
		.join("|");
}

function hasLocationSnapshot(input: RequestMetaSource): boolean {
	return Boolean(
		input.ipCountry ||
			input.ipRegion ||
			input.ipCity ||
			input.ipIsp ||
			input.ipLocationSource ||
			input.ipLocationUpdatedAt ||
			input.ipLocationError,
	);
}

function hasDeviceSnapshot(input: RequestMetaSource): boolean {
	return Boolean(
		input.deviceBrowser ||
			input.deviceBrowserVersion ||
			input.deviceOs ||
			input.deviceOsVersion ||
			input.deviceType ||
			input.deviceIcon ||
			input.deviceSource ||
			input.deviceUpdatedAt ||
			input.deviceError,
	);
}

function aggregateIpLocations(
	rows: RequestMetaAggregateSource[],
): RequestMetaAggregate[] {
	const groups = new Map<
		string,
		{
			input: RequestMetaSource;
			count: number;
			ips: Set<string>;
		}
	>();

	for (const row of rows) {
		if (!hasLocationSnapshot(row)) {
			continue;
		}
		const key = locationKey(row);
		const rowCount = row.count ?? 1;
		const group = groups.get(key) ?? {
			input: row,
			count: 0,
			ips: new Set<string>(),
		};
		group.count += rowCount;
		if (row.ip) {
			group.ips.add(row.ip);
		}
		groups.set(key, group);
	}

	return [...groups.entries()]
		.map(([key, group]) => ({
			key,
			label: formatIpLocationLabel({
				country: group.input.ipCountry,
				region: group.input.ipRegion,
				city: group.input.ipCity,
				error: group.input.ipLocationError,
			}),
			count: group.count,
			distinctIpCount: group.ips.size,
		}))
		.sort(
			(left, right) =>
				right.count - left.count || left.key.localeCompare(right.key),
		)
		.slice(0, 3);
}

function aggregateDevices(
	rows: RequestMetaAggregateSource[],
): RequestMetaAggregate[] {
	const groups = new Map<
		string,
		{
			input: RequestMetaSource;
			count: number;
		}
	>();

	for (const row of rows) {
		if (!hasDeviceSnapshot(row)) {
			continue;
		}
		const key = deviceKey(row);
		const rowCount = row.count ?? 1;
		const group = groups.get(key) ?? {
			input: row,
			count: 0,
		};
		group.count += rowCount;
		groups.set(key, group);
	}

	return [...groups.entries()]
		.map(([key, group]) => ({
			key,
			label: formatDeviceLabel({
				browser: group.input.deviceBrowser,
				browserVersion: group.input.deviceBrowserVersion,
				os: group.input.deviceOs,
				osVersion: group.input.deviceOsVersion,
				type: group.input.deviceType,
				error: group.input.deviceError,
			}),
			count: group.count,
		}))
		.sort(
			(left, right) =>
				right.count - left.count || left.key.localeCompare(right.key),
		)
		.slice(0, 3);
}

type AdminPageSortBy =
	| "updatedAt"
	| "createdAt"
	| "commentCount"
	| "visitorCount"
	| "commenterCount"
	| "pageLikeCount"
	| "title"
	| "pageKey";

interface AdminPageItem {
	siteKey: string;
	pageKey: string;
	status: string;
	pageTitle: string | null;
	pageUrl: string | null;
	commentCount: number;
	rootCommentCount: number;
	pageLikeCount: number;
	updatedAt: string;
	createdAt: string;
	trashedAt: string | null;
	deletedAt: string | null;
	titleRefreshAttemptedAt: string | null;
	titleRefreshedAt: string | null;
	titleRefreshStatusCode: number | null;
	titleRefreshError: string | null;
	visitorCount: number;
	commenterCount: number;
	engagement?: AdminEngagementSummary;
}

export interface AdminEngagementSummary {
	trustMode: "trusted" | "lightweight";
	visitorsEnabled: boolean;
	pageViewsEnabled: boolean;
	pageLikesEnabled: boolean;
	commentVotesEnabled: boolean;
}

export function buildAdminEngagementSummary(
	engagement: EngagementSettings,
): AdminEngagementSummary {
	return {
		trustMode: engagement.visitors.enabled ? "trusted" : "lightweight",
		visitorsEnabled: engagement.visitors.enabled,
		pageViewsEnabled: engagement.pageViews.enabled,
		pageLikesEnabled: engagement.pageLikes.enabled,
		commentVotesEnabled: engagement.commentVotes.enabled,
	};
}

function parseEngagementSettings(payload?: string | null): EngagementSettings {
	return mergeEngagementSettings(payload);
}

export class AdminRepository {
	public constructor(private readonly db: DatabaseExecutor) {}

	public get database(): DatabaseExecutor {
		return this.db;
	}

	public async listSites() {
		return this.db.select().from(sites);
	}

	public async getOverviewStats() {
		const [
			siteTotal,
			pageTotal,
			commentTotal,
			pendingCommentTotal,
			commenterTotal,
			visitorTotal,
			blacklistTotal,
		] = await Promise.all([
			this.db
				.select({
					value: count(),
				})
				.from(sites),
			this.db
				.select({
					value: count(),
				})
				.from(pageThreads)
				.where(eq(pageThreads.kind, "public")),
			this.db
				.select({
					value: count(),
				})
				.from(comments)
				.innerJoin(pageThreads, eq(pageThreads.id, comments.pageThreadId))
				.where(and(isNull(comments.deletedAt), eq(pageThreads.kind, "public"))),
			this.db
				.select({
					value: count(),
				})
				.from(comments)
				.innerJoin(pageThreads, eq(pageThreads.id, comments.pageThreadId))
				.where(
					and(
						isNull(comments.deletedAt),
						eq(comments.status, "pending"),
						eq(pageThreads.kind, "public"),
					),
				),
			this.db
				.select({
					value: sql<number>`COUNT(DISTINCT ${comments.authorEmail})`,
				})
				.from(comments)
				.innerJoin(pageThreads, eq(pageThreads.id, comments.pageThreadId))
				.where(
					and(isNotNull(comments.authorEmail), eq(pageThreads.kind, "public")),
				),
			this.db
				.select({
					value: count(),
				})
				.from(visitors),
			this.db
				.select({
					value: count(),
				})
				.from(blacklistRules),
		]);

		return {
			siteCount: Number(siteTotal[0]?.value ?? 0),
			pageCount: Number(pageTotal[0]?.value ?? 0),
			commentCount: Number(commentTotal[0]?.value ?? 0),
			pendingCommentCount: Number(pendingCommentTotal[0]?.value ?? 0),
			commenterCount: Number(commenterTotal[0]?.value ?? 0),
			visitorCount: Number(visitorTotal[0]?.value ?? 0),
			blacklistRuleCount: Number(blacklistTotal[0]?.value ?? 0),
		};
	}

	private async listActiveBlacklistRules(
		targetType: "email" | "ip" | "visitor",
		siteId?: number,
	) {
		const nowIso = new Date().toISOString();

		return this.db
			.select()
			.from(blacklistRules)
			.where(
				and(
					eq(blacklistRules.targetType, targetType),
					siteId === undefined
						? undefined
						: or(
								isNull(blacklistRules.siteId),
								eq(blacklistRules.siteId, siteId),
							),
					or(
						isNull(blacklistRules.expiresAt),
						gte(blacklistRules.expiresAt, nowIso),
					),
				),
			);
	}

	public async getSiteByKey(siteKey: string) {
		const [site] = await this.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, siteKey))
			.limit(1);

		return site;
	}

	public async createSite(input: {
		siteKey: string;
		name: string;
		allowedOrigins: string[];
	}) {
		const allowedOriginsJson = JSON.stringify(input.allowedOrigins);
		await this.db.insert(sites).values({
			siteKey: input.siteKey,
			name: input.name,
			allowedOriginsJson,
		});

		const site = await this.getSiteByKey(input.siteKey);
		if (!site) {
			return undefined;
		}

		await this.db
			.insert(siteSettings)
			.values(buildDefaultSiteSettings(site.id))
			.onConflictDoNothing({
				target: siteSettings.siteId,
			});

		return site;
	}

	public async updateSite(
		siteKey: string,
		input: {
			name?: string;
			allowedOrigins?: string[];
		},
	) {
		await this.db
			.update(sites)
			.set({
				name: input.name,
				allowedOriginsJson: input.allowedOrigins
					? JSON.stringify(input.allowedOrigins)
					: undefined,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(sites.siteKey, siteKey));

		return this.getSiteByKey(siteKey);
	}

	public async createAdminSession(input: {
		id: string;
		userId?: number;
		tokenHash: string;
		csrfTokenHash?: string;
		csrfIssuedAt?: string;
		ip?: string;
		userAgent?: string;
		expiresAt: string;
	}) {
		await this.db.insert(adminSessions).values(input);
	}

	public async getAdminSessionByTokenHash(tokenHash: string) {
		const [session] = await this.db
			.select()
			.from(adminSessions)
			.where(eq(adminSessions.tokenHash, tokenHash))
			.limit(1);

		return session;
	}

	public async deleteAdminSession(id: string) {
		await this.db.delete(adminSessions).where(eq(adminSessions.id, id));
	}

	public async updateAdminSessionCsrf(input: {
		id: string;
		csrfTokenHash: string;
		csrfIssuedAt: string;
	}) {
		await this.db
			.update(adminSessions)
			.set({
				csrfTokenHash: input.csrfTokenHash,
				csrfIssuedAt: input.csrfIssuedAt,
				lastSeenAt: input.csrfIssuedAt,
			})
			.where(eq(adminSessions.id, input.id));
	}

	public async listComments(input: {
		commentId?: string;
		siteId?: number;
		pageKey?: string;
		status?: CommentStatus;
		statusGroup?: "hidden";
		avatar?: SystemSettings["avatar"];
		search?: string;
		limit: number;
		offset: number;
	}) {
		const hasExplicitStatusFilter = Boolean(
			input.commentId || input.status || input.statusGroup,
		);
		const conditions = [
			input.commentId ? eq(comments.id, input.commentId) : undefined,
			input.siteId ? eq(comments.siteId, input.siteId) : undefined,
			eq(pageThreads.kind, "public"),
			input.status ? eq(comments.status, input.status) : undefined,
			input.statusGroup === "hidden"
				? inArray(comments.status, ["spam", "trash"])
				: undefined,
			hasExplicitStatusFilter
				? undefined
				: inArray(comments.status, ["pending", "approved"]),
			isNull(comments.deletedAt),
		].filter((condition) => condition !== undefined);

		const emailHash = input.search?.includes("@")
			? hashCommentEmail(input.search)
			: undefined;
		const searchCondition =
			input.search === undefined
				? undefined
				: or(
						ilike(comments.authorName, `%${input.search}%`),
						ilike(comments.contentRaw, `%${input.search}%`),
						emailHash ? eq(comments.authorEmailHash, emailHash) : undefined,
					);

		const pageKeyCondition =
			input.pageKey === undefined
				? undefined
				: sql`${comments.pageThreadId} IN (
						SELECT id FROM ${pageThreads}
						WHERE ${pageThreads.pageKey} = ${input.pageKey}
						AND ${pageThreads.kind} = 'public'
					)`;

		const whereCondition = and(
			...conditions,
			searchCondition,
			pageKeyCondition,
		);

		const rows = await this.db
			.select({
				id: comments.id,
				parentId: comments.parentId,
				status: comments.status,
				authorName: comments.authorName,
				authorEmail: comments.authorEmail,
				authorEmailHash: comments.authorEmailHash,
				authorIp: commentRequestMetadata.authorIp,
				authorUserAgent: commentRequestMetadata.authorUserAgent,
				ipCountry: commentRequestMetadata.ipCountry,
				ipRegion: commentRequestMetadata.ipRegion,
				ipCity: commentRequestMetadata.ipCity,
				ipIsp: commentRequestMetadata.ipIsp,
				ipLocationRaw: commentRequestMetadata.ipLocationRaw,
				ipLocationSource: commentRequestMetadata.ipLocationSource,
				ipLocationDbHash: commentRequestMetadata.ipLocationDbHash,
				ipLocationUpdatedAt: commentRequestMetadata.ipLocationUpdatedAt,
				ipLocationError: commentRequestMetadata.ipLocationError,
				deviceBrowser: commentRequestMetadata.deviceBrowser,
				deviceBrowserVersion: commentRequestMetadata.deviceBrowserVersion,
				deviceOs: commentRequestMetadata.deviceOs,
				deviceOsVersion: commentRequestMetadata.deviceOsVersion,
				deviceType: commentRequestMetadata.deviceType,
				deviceIcon: commentRequestMetadata.deviceIcon,
				deviceSource: commentRequestMetadata.deviceSource,
				deviceUpdatedAt: commentRequestMetadata.deviceUpdatedAt,
				deviceError: commentRequestMetadata.deviceError,
				contentRaw: comments.contentRaw,
				isPinned: comments.isPinned,
				isFolded: comments.isFolded,
				replyCount: comments.replyCount,
				voteUpCount: comments.voteUpCount,
				voteDownCount: comments.voteDownCount,
				createdAt: comments.createdAt,
				updatedAt: comments.updatedAt,
				siteKey: sites.siteKey,
				pageKey: pageThreads.pageKey,
				pageTitle: pageThreads.pageTitle,
				pageUrl: pageThreads.pageUrl,
				allowedOriginsJson: sites.allowedOriginsJson,
			})
			.from(comments)
			.innerJoin(pageThreads, eq(pageThreads.id, comments.pageThreadId))
			.innerJoin(sites, eq(sites.id, comments.siteId))
			.leftJoin(
				commentRequestMetadata,
				eq(commentRequestMetadata.commentId, comments.id),
			)
			.where(whereCondition)
			.orderBy(desc(comments.createdAt))
			.limit(input.limit)
			.offset(input.offset);

		const [total] = await this.db
			.select({
				value: count(),
			})
			.from(comments)
			.innerJoin(pageThreads, eq(pageThreads.id, comments.pageThreadId))
			.where(whereCondition);
		const emailRules = await this.listActiveBlacklistRules(
			"email",
			input.siteId,
		);
		const ipRules = await this.listActiveBlacklistRules("ip", input.siteId);

		return {
			items: rows.map((row) => {
				const emailBlacklisted = emailRules.some((rule) =>
					matchBlacklistRule(
						{
							targetType: rule.targetType,
							targetValue: rule.targetValue,
							matchMode: rule.matchMode,
						},
						{ email: row.authorEmail ?? undefined },
					),
				);
				const ipBlacklisted = ipRules.some((rule) =>
					matchBlacklistRule(
						{
							targetType: rule.targetType,
							targetValue: rule.targetValue,
							matchMode: rule.matchMode,
						},
						{ ip: row.authorIp ?? undefined },
					),
				);

				return {
					id: row.id,
					parentId: row.parentId,
					status: row.status,
					authorName: row.authorName,
					authorEmail: row.authorEmail,
					authorAvatarUrl:
						buildExternalAvatarUrl({
							enabled: input.avatar?.external.enabled ?? false,
							email: row.authorEmail,
							baseUrl:
								input.avatar?.external.baseUrl ?? "https://gravatar.com/avatar",
							hashAlgorithm: input.avatar?.external.hashAlgorithm ?? "sha256",
							query: input.avatar?.external.query ?? "s=80&d=404&r=g",
						}) ?? null,
					authorIp: row.authorIp,
					authorUserAgent: row.authorUserAgent,
					requestMeta: buildRequestMeta({
						ip: row.authorIp,
						userAgent: row.authorUserAgent,
						ipCountry: row.ipCountry,
						ipRegion: row.ipRegion,
						ipCity: row.ipCity,
						ipIsp: row.ipIsp,
						ipLocationSource: row.ipLocationSource,
						ipLocationUpdatedAt: row.ipLocationUpdatedAt,
						ipLocationError: row.ipLocationError,
						deviceBrowser: row.deviceBrowser,
						deviceBrowserVersion: row.deviceBrowserVersion,
						deviceOs: row.deviceOs,
						deviceOsVersion: row.deviceOsVersion,
						deviceType: row.deviceType,
						deviceIcon: row.deviceIcon,
						deviceSource: row.deviceSource,
						deviceUpdatedAt: row.deviceUpdatedAt,
						deviceError: row.deviceError,
					}),
					authorIpLocation: {
						country: row.ipCountry,
						region: row.ipRegion,
						city: row.ipCity,
						isp: row.ipIsp,
						raw: row.ipLocationRaw,
						source: row.ipLocationSource,
						dbHash: row.ipLocationDbHash,
						updatedAt: row.ipLocationUpdatedAt,
						error: row.ipLocationError,
					},
					blacklist: {
						email: emailBlacklisted,
						ip: ipBlacklisted,
					},
					contentRaw: row.contentRaw,
					isPinned: row.isPinned,
					isFolded: row.isFolded,
					replyCount: row.replyCount,
					voteUpCount: row.voteUpCount,
					voteDownCount: row.voteDownCount,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
					siteKey: row.siteKey,
					pageKey: row.pageKey,
					pageTitle: row.pageTitle,
					pageUrl: resolvePublicPageUrl(
						row.pageUrl,
						parseStringArray(row.allowedOriginsJson),
					),
				};
			}),
			totalCount: total?.value ?? 0,
		};
	}

	public async listPages(input: {
		siteId?: number;
		search?: string;
		status?:
			| "active"
			| "stale"
			| "unreachable"
			| "not_found"
			| "trash"
			| "deleted"
			| "ignored";
		sortBy: AdminPageSortBy;
		sortOrder: "asc" | "desc";
		limit: number;
		offset: number;
	}) {
		const searchValue = input.search ? `%${input.search}%` : undefined;
		const conditions = and(
			input.siteId ? eq(sitePageRegistry.siteId, input.siteId) : undefined,
			input.status ? eq(sitePageRegistry.status, input.status) : undefined,
			searchValue
				? or(
						ilike(sitePageRegistry.pageKey, searchValue),
						ilike(sitePageRegistry.title, searchValue),
						ilike(sitePageRegistry.pageUrl, searchValue),
					)
				: undefined,
		);
		const visitorCount = sql<number>`(
			SELECT count(DISTINCT ${pageViewSessions.visitorId})
			FROM ${pageViewSessions}
			WHERE ${pageViewSessions.pageThreadId} = ${pageThreads.id}
		)`
			.mapWith(Number)
			.as("visitor_count");
		const commenterCount = sql<number>`(
			SELECT count(DISTINCT ${comments.authorEmail})
			FROM ${comments}
			WHERE ${comments.pageThreadId} = ${pageThreads.id}
			AND ${comments.deletedAt} IS NULL
		)`
			.mapWith(Number)
			.as("commenter_count");
		const sortColumns = {
			updatedAt: sitePageRegistry.updatedAt,
			createdAt: sitePageRegistry.createdAt,
			commentCount: sql`coalesce(${pageThreads.commentCount}, 0)`,
			visitorCount,
			commenterCount,
			pageLikeCount: sql`coalesce(${pageThreads.pageLikeCount}, 0)`,
			title: sql`coalesce(${sitePageRegistry.title}, ${pageThreads.pageTitle}, '')`,
			pageKey: sitePageRegistry.pageKey,
		};
		const order = input.sortOrder === "asc" ? asc : desc;
		const pageRows = this.db
			.select({
				id: sitePageRegistry.id,
				siteId: sitePageRegistry.siteId,
				siteKey: sites.siteKey,
				allowedOriginsJson: sites.allowedOriginsJson,
				pageKey: sitePageRegistry.pageKey,
				pageTitle: sitePageRegistry.title,
				pageUrl: sitePageRegistry.pageUrl,
				status: sitePageRegistry.status,
				titleRefreshAttemptedAt: sitePageRegistry.titleRefreshAttemptedAt,
				titleRefreshedAt: sitePageRegistry.titleRefreshedAt,
				titleRefreshStatusCode: sitePageRegistry.titleRefreshStatusCode,
				titleRefreshError: sitePageRegistry.titleRefreshError,
				engagementJson: siteSettings.engagementJson,
				trashedAt: sitePageRegistry.trashedAt,
				deletedAt: sitePageRegistry.deletedAt,
				createdAt: sitePageRegistry.createdAt,
				threadPageTitle: pageThreads.pageTitle,
				threadPageUrl: sql<string | null>`${pageThreads.pageUrl}`.as(
					"thread_page_url",
				),
				commentCount: pageThreads.commentCount,
				rootCommentCount: pageThreads.rootCommentCount,
				pageLikeCount: pageThreads.pageLikeCount,
				updatedAt: sitePageRegistry.updatedAt,
				visitorCount,
				commenterCount,
			})
			.from(sitePageRegistry)
			.innerJoin(sites, eq(sites.id, sitePageRegistry.siteId))
			.innerJoin(siteSettings, eq(siteSettings.siteId, sitePageRegistry.siteId))
			.leftJoin(
				pageThreads,
				and(
					eq(pageThreads.siteId, sitePageRegistry.siteId),
					eq(pageThreads.pageKeyHash, sitePageRegistry.pageKeyHash),
					eq(pageThreads.pageKey, sitePageRegistry.pageKey),
					eq(pageThreads.kind, "public"),
				),
			)
			.where(conditions)
			.orderBy(
				order(sortColumns[input.sortBy]),
				desc(sitePageRegistry.updatedAt),
				desc(sitePageRegistry.id),
			)
			.limit(input.limit)
			.offset(input.offset)
			.as("paged_pages");
		const totals = this.db
			.select({ totalCount: count().as("total_count") })
			.from(sitePageRegistry)
			.innerJoin(sites, eq(sites.id, sitePageRegistry.siteId))
			.innerJoin(siteSettings, eq(siteSettings.siteId, sitePageRegistry.siteId))
			.where(conditions)
			.as("page_totals");
		const pageSortColumns = {
			updatedAt: pageRows.updatedAt,
			createdAt: pageRows.createdAt,
			commentCount: sql`coalesce(${pageRows.commentCount}, 0)`,
			visitorCount: pageRows.visitorCount,
			commenterCount: pageRows.commenterCount,
			pageLikeCount: sql`coalesce(${pageRows.pageLikeCount}, 0)`,
			title: sql`coalesce(${pageRows.pageTitle}, ${pageRows.threadPageTitle}, '')`,
			pageKey: pageRows.pageKey,
		};
		const rows = await this.db
			.select()
			.from(pageRows)
			.rightJoin(totals, sql`true`)
			.orderBy(
				order(pageSortColumns[input.sortBy]),
				desc(pageRows.updatedAt),
				desc(pageRows.id),
			);
		const items: AdminPageItem[] = rows.flatMap(({ paged_pages: row }) =>
			row
				? [
						{
							siteKey: row.siteKey,
							pageKey: row.pageKey,
							status: row.status,
							pageTitle: row.pageTitle ?? row.threadPageTitle,
							pageUrl: resolvePublicPageUrl(
								row.pageUrl ?? row.threadPageUrl,
								parseStringArray(row.allowedOriginsJson),
							),
							commentCount: row.commentCount ?? 0,
							rootCommentCount: row.rootCommentCount ?? 0,
							pageLikeCount: row.pageLikeCount ?? 0,
							updatedAt: row.updatedAt,
							createdAt: row.createdAt,
							trashedAt: row.trashedAt,
							deletedAt: row.deletedAt,
							titleRefreshAttemptedAt: row.titleRefreshAttemptedAt,
							titleRefreshedAt: row.titleRefreshedAt,
							titleRefreshStatusCode: row.titleRefreshStatusCode,
							titleRefreshError: row.titleRefreshError,
							visitorCount: row.visitorCount,
							commenterCount: row.commenterCount,
							engagement: buildAdminEngagementSummary(
								parseEngagementSettings(row.engagementJson),
							),
						},
					]
				: [],
		);
		return {
			items,
			totalCount: rows[0]?.page_totals.totalCount ?? 0,
		};
	}

	public async listCommenters(input: {
		siteId?: number;
		search?: string;
		limit: number;
		offset: number;
	}) {
		const normalizedEmail = sql<string>`lower(trim(${comments.authorEmail}))`;
		const searchValue = input.search
			? `%${input.search.trim().toLowerCase()}%`
			: undefined;
		const rows = await this.db
			.select({
				email: normalizedEmail,
				emailVariantsJson: sql<string>`jsonb_agg(${comments.authorEmail} ORDER BY ${comments.createdAt}, ${comments.id})`,
				namesJson: sql<string>`jsonb_agg(${comments.authorName} ORDER BY ${comments.createdAt}, ${comments.id})`,
				commentCount: count(),
				pendingCount: sql<number>`SUM(CASE WHEN ${comments.status} = 'pending' THEN 1 ELSE 0 END)`,
				approvedCount: sql<number>`SUM(CASE WHEN ${comments.status} = 'approved' THEN 1 ELSE 0 END)`,
				lastCommentAt: sql<string>`MAX(${comments.createdAt})`,
				pageCount: sql<number>`COUNT(DISTINCT ${comments.pageThreadId})`,
				siteCount: sql<number>`COUNT(DISTINCT ${comments.siteId})`,
				ipsJson: sql<string>`jsonb_agg(${commentRequestMetadata.authorIp} ORDER BY ${comments.createdAt}, ${comments.id})`,
				userAgentsJson: sql<string>`jsonb_agg(${commentRequestMetadata.authorUserAgent} ORDER BY ${comments.createdAt}, ${comments.id})`,
			})
			.from(comments)
			.innerJoin(pageThreads, eq(pageThreads.id, comments.pageThreadId))
			.leftJoin(
				commentRequestMetadata,
				eq(commentRequestMetadata.commentId, comments.id),
			)
			.where(
				and(
					isNull(comments.deletedAt),
					isNotNull(comments.authorEmail),
					eq(pageThreads.kind, "public"),
					input.siteId ? eq(comments.siteId, input.siteId) : undefined,
					searchValue
						? or(
								ilike(normalizedEmail, searchValue),
								ilike(comments.authorName, searchValue),
							)
						: undefined,
				),
			)
			.groupBy(normalizedEmail);
		const emailRules = await this.listActiveBlacklistRules(
			"email",
			input.siteId,
		);
		const items = rows
			.map((row) => {
				const ips = Array.from(new Set(parseStringArray(row.ipsJson)));
				const emailBlacklisted = emailRules.some((rule) =>
					matchBlacklistRule(
						{
							targetType: rule.targetType,
							targetValue: rule.targetValue,
							matchMode: rule.matchMode,
						},
						{ email: row.email ?? undefined },
					),
				);

				return {
					email: row.email ?? "",
					emailVariants: Array.from(
						new Set(parseStringArray(row.emailVariantsJson)),
					),
					names: Array.from(new Set(parseStringArray(row.namesJson))),
					commentCount: Number(row.commentCount ?? 0),
					pendingCount: Number(row.pendingCount ?? 0),
					approvedCount: Number(row.approvedCount ?? 0),
					lastCommentAt: row.lastCommentAt,
					pageCount: Number(row.pageCount ?? 0),
					siteCount: Number(row.siteCount ?? 0),
					ips,
					userAgents: Array.from(new Set(parseStringArray(row.userAgentsJson))),
					blacklist: {
						email: emailBlacklisted,
					},
					isBlacklisted: emailBlacklisted,
				};
			})
			.sort((left, right) =>
				(right.lastCommentAt ?? "").localeCompare(left.lastCommentAt ?? ""),
			);
		const pagedItems = items.slice(input.offset, input.offset + input.limit);
		const pageEmails = pagedItems.map((item) => item.email);
		const metadataByEmail = new Map<string, RequestMetaSource[]>();
		const notificationsByEmail = new Map<
			string,
			{
				notifyOnReply: boolean | null;
				unsubscribedAt: string | null;
				suppressedUntil: string | null;
				reputationScore: number | null;
				lastSuccessAt: string | null;
				lastFailureAt: string | null;
			}
		>();
		if (input.siteId && pageEmails.length > 0) {
			const preferenceRows = await this.db
				.select()
				.from(commenterNotificationPreferences)
				.where(
					and(
						eq(commenterNotificationPreferences.siteId, input.siteId),
						inArray(commenterNotificationPreferences.email, pageEmails),
					),
				);
			const reputationRows = await this.db
				.select()
				.from(emailDeliveryReputation)
				.where(
					and(
						eq(emailDeliveryReputation.siteId, input.siteId),
						inArray(emailDeliveryReputation.email, pageEmails),
					),
				);
			for (const row of preferenceRows) {
				notificationsByEmail.set(row.email, {
					notifyOnReply: row.notifyOnReply,
					unsubscribedAt: row.unsubscribedAt,
					suppressedUntil: null,
					reputationScore: null,
					lastSuccessAt: null,
					lastFailureAt: null,
				});
			}
			for (const row of reputationRows) {
				const current = notificationsByEmail.get(row.email);
				notificationsByEmail.set(row.email, {
					notifyOnReply: current?.notifyOnReply ?? null,
					unsubscribedAt: current?.unsubscribedAt ?? null,
					suppressedUntil: row.suppressedUntil,
					reputationScore: row.failureScore,
					lastSuccessAt: row.lastSuccessAt,
					lastFailureAt: row.lastFailureAt,
				});
			}
		}
		if (pageEmails.length > 0) {
			const metadataRows = await this.db
				.select({
					email: normalizedEmail,
					ip: commentRequestMetadata.authorIp,
					userAgent: commentRequestMetadata.authorUserAgent,
					ipCountry: commentRequestMetadata.ipCountry,
					ipRegion: commentRequestMetadata.ipRegion,
					ipCity: commentRequestMetadata.ipCity,
					ipIsp: commentRequestMetadata.ipIsp,
					ipLocationSource: commentRequestMetadata.ipLocationSource,
					ipLocationUpdatedAt: commentRequestMetadata.ipLocationUpdatedAt,
					ipLocationError: commentRequestMetadata.ipLocationError,
					deviceBrowser: commentRequestMetadata.deviceBrowser,
					deviceBrowserVersion: commentRequestMetadata.deviceBrowserVersion,
					deviceOs: commentRequestMetadata.deviceOs,
					deviceOsVersion: commentRequestMetadata.deviceOsVersion,
					deviceType: commentRequestMetadata.deviceType,
					deviceIcon: commentRequestMetadata.deviceIcon,
					deviceSource: commentRequestMetadata.deviceSource,
					deviceUpdatedAt: commentRequestMetadata.deviceUpdatedAt,
					deviceError: commentRequestMetadata.deviceError,
				})
				.from(comments)
				.innerJoin(pageThreads, eq(pageThreads.id, comments.pageThreadId))
				.leftJoin(
					commentRequestMetadata,
					eq(commentRequestMetadata.commentId, comments.id),
				)
				.where(
					and(
						isNull(comments.deletedAt),
						isNotNull(comments.authorEmail),
						eq(pageThreads.kind, "public"),
						input.siteId ? eq(comments.siteId, input.siteId) : undefined,
						inArray(normalizedEmail, pageEmails),
					),
				);
			for (const row of metadataRows) {
				if (!row.email) {
					continue;
				}
				const records = metadataByEmail.get(row.email) ?? [];
				records.push({
					ip: row.ip,
					userAgent: row.userAgent,
					ipCountry: row.ipCountry,
					ipRegion: row.ipRegion,
					ipCity: row.ipCity,
					ipIsp: row.ipIsp,
					ipLocationSource: row.ipLocationSource,
					ipLocationUpdatedAt: row.ipLocationUpdatedAt,
					ipLocationError: row.ipLocationError,
					deviceBrowser: row.deviceBrowser,
					deviceBrowserVersion: row.deviceBrowserVersion,
					deviceOs: row.deviceOs,
					deviceOsVersion: row.deviceOsVersion,
					deviceType: row.deviceType,
					deviceIcon: row.deviceIcon,
					deviceSource: row.deviceSource,
					deviceUpdatedAt: row.deviceUpdatedAt,
					deviceError: row.deviceError,
				});
				metadataByEmail.set(row.email, records);
			}
		}

		return {
			items: pagedItems.map((item) => {
				const metadataRows = metadataByEmail.get(item.email) ?? [];
				return {
					...item,
					notifications: notificationsByEmail.get(item.email),
					ipLocations: aggregateIpLocations(metadataRows),
					devices: aggregateDevices(metadataRows),
				};
			}),
			totalCount: items.length,
		};
	}

	public async listVisitors(input: {
		siteId?: number;
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
		const searchValue = input.search ? `%${input.search}%` : undefined;
		const ipValue = input.ip ? `%${input.ip}%` : undefined;
		const userAgentValue = input.userAgent ? `%${input.userAgent}%` : undefined;
		const pageUrlValue = input.pageUrl ? `%${input.pageUrl}%` : undefined;
		const deviceValue = input.device ? `%${input.device}%` : undefined;
		const locationValue = input.location ? `%${input.location}%` : undefined;
		const filters = and(
			input.siteId ? eq(visitors.siteId, input.siteId) : undefined,
			searchValue
				? or(
						sql`${visitors.visitorKey} ILIKE ${searchValue} ESCAPE ''`,
						sql`${visitors.lastIp} ILIKE ${searchValue} ESCAPE ''`,
						sql`${visitors.lastUserAgent} ILIKE ${searchValue} ESCAPE ''`,
						sql`${visitors.lastSeenPageUrl} ILIKE ${searchValue} ESCAPE ''`,
					)
				: undefined,
			ipValue
				? or(
						sql`${visitors.lastIp} ILIKE ${ipValue} ESCAPE ''`,
						sql`EXISTS (
									SELECT 1 FROM visitor_request_metadata
									WHERE visitor_request_metadata.visitor_id = ${visitors.id}
									AND visitor_request_metadata.ip ILIKE ${ipValue} ESCAPE ''
								)`,
					)
				: undefined,
			userAgentValue
				? or(
						sql`${visitors.lastUserAgent} ILIKE ${userAgentValue} ESCAPE ''`,
						sql`EXISTS (
									SELECT 1 FROM visitor_request_metadata
									WHERE visitor_request_metadata.visitor_id = ${visitors.id}
									AND visitor_request_metadata.user_agent ILIKE ${userAgentValue} ESCAPE ''
								)`,
					)
				: undefined,
			pageUrlValue
				? or(
						sql`${visitors.lastSeenPageUrl} ILIKE ${pageUrlValue} ESCAPE ''`,
						sql`EXISTS (
									SELECT 1 FROM visitor_request_metadata
									WHERE visitor_request_metadata.visitor_id = ${visitors.id}
									AND visitor_request_metadata.last_seen_page_url ILIKE ${pageUrlValue} ESCAPE ''
								)`,
					)
				: undefined,
			deviceValue
				? sql`EXISTS (
								SELECT 1 FROM visitor_request_metadata
								WHERE visitor_request_metadata.visitor_id = ${visitors.id}
								AND (
									visitor_request_metadata.device_browser ILIKE ${deviceValue} ESCAPE ''
									OR visitor_request_metadata.device_os ILIKE ${deviceValue} ESCAPE ''
									OR visitor_request_metadata.device_type ILIKE ${deviceValue} ESCAPE ''
								)
							)`
				: undefined,
			locationValue
				? sql`EXISTS (
								SELECT 1 FROM visitor_request_metadata
								WHERE visitor_request_metadata.visitor_id = ${visitors.id}
								AND (
									visitor_request_metadata.ip_country ILIKE ${locationValue} ESCAPE ''
									OR visitor_request_metadata.ip_region ILIKE ${locationValue} ESCAPE ''
									OR visitor_request_metadata.ip_city ILIKE ${locationValue} ESCAPE ''
									OR visitor_request_metadata.ip_isp ILIKE ${locationValue} ESCAPE ''
								)
							)`
				: undefined,
		);
		const visitorRules = await this.listActiveBlacklistRules(
			"visitor",
			input.siteId,
		);
		const ipRules = await this.listActiveBlacklistRules("ip", input.siteId);
		const effectiveIp = sql<string | null>`COALESCE(visitors.last_ip, (
			SELECT ip FROM visitor_request_metadata
			WHERE visitor_id = visitors.id
			ORDER BY last_seen_at DESC LIMIT 1
		))`;
		let blacklistFilter: SQL | undefined;
		if (input.blacklist) {
			const visitorMatch = sql`${visitors.visitorKey} = ANY(${sql.param(visitorRules.map((rule) => rule.targetValue))}::text[])`;
			const exactIps = ipRules
				.filter((rule) => rule.matchMode !== "cidr" && rule.targetValue)
				.map((rule) => rule.targetValue);
			const cidrRules = ipRules.filter((rule) => rule.matchMode === "cidr");
			if (input.blacklist !== "visitor" && cidrRules.length > 0) {
				const candidateIps = await this.db
					.selectDistinct({ ip: effectiveIp })
					.from(visitors)
					.where(filters);
				for (const { ip } of candidateIps) {
					if (
						ip &&
						cidrRules.some((rule) => matchBlacklistRule(rule, { ip }))
					) {
						exactIps.push(ip);
					}
				}
			}
			const ipMatch = sql`COALESCE(${effectiveIp} = ANY(${sql.param(exactIps)}::text[]), false)`;
			blacklistFilter =
				input.blacklist === "any"
					? or(ipMatch, visitorMatch)
					: input.blacklist === "ip"
						? ipMatch
						: input.blacklist === "visitor"
							? visitorMatch
							: sql`NOT (${ipMatch} OR ${visitorMatch})`;
		}
		const where = and(filters, blacklistFilter);
		const [total] = await this.db
			.select({ value: count() })
			.from(visitors)
			.where(where);
		const totalCount = Number(total?.value ?? 0);
		const rows = await this.db
			.select({
				id: visitors.id,
				siteId: visitors.siteId,
				siteKey: sites.siteKey,
				visitorKey: visitors.visitorKey,
				lastIp: visitors.lastIp,
				lastUserAgent: visitors.lastUserAgent,
				lastSeenPageKey: visitors.lastSeenPageKey,
				lastSeenPageUrl: visitors.lastSeenPageUrl,
				allowedOriginsJson: sites.allowedOriginsJson,
				lastSeenAt: visitors.lastSeenAt,
				createdAt: visitors.createdAt,
			})
			.from(visitors)
			.innerJoin(sites, eq(sites.id, visitors.siteId))
			.where(where)
			.orderBy(desc(visitors.lastSeenAt), desc(visitors.id))
			.limit(input.limit)
			.offset(input.offset);

		const visitorIds = rows.map((row) => row.id);
		if (visitorIds.length === 0) {
			return {
				items: [],
				totalCount,
			};
		}

		const commentStatsRows = await this.db
			.select({
				visitorId: comments.visitorId,
				commentCount: count(),
				emailCount: sql<number>`COUNT(DISTINCT ${comments.authorEmail})`,
				emailsJson: sql<string>`jsonb_agg(${comments.authorEmail} ORDER BY ${comments.createdAt}, ${comments.id})`,
				ipsJson: sql<string>`jsonb_agg(${commentRequestMetadata.authorIp} ORDER BY ${comments.createdAt}, ${comments.id})`,
				userAgentsJson: sql<string>`jsonb_agg(${commentRequestMetadata.authorUserAgent} ORDER BY ${comments.createdAt}, ${comments.id})`,
			})
			.from(comments)
			.leftJoin(
				commentRequestMetadata,
				eq(commentRequestMetadata.commentId, comments.id),
			)
			.where(
				and(
					isNull(comments.deletedAt),
					isNotNull(comments.visitorId),
					inArray(comments.visitorId, visitorIds),
				),
			)
			.groupBy(comments.visitorId);
		const pageCountMap = toCountMap(
			await this.db
				.select({
					key: pageViewSessions.visitorId,
					value: sql<number>`COUNT(DISTINCT ${pageViewSessions.pageThreadId})`,
				})
				.from(pageViewSessions)
				.where(
					and(
						isNotNull(pageViewSessions.visitorId),
						inArray(pageViewSessions.visitorId, visitorIds),
					),
				)
				.groupBy(pageViewSessions.visitorId),
		);
		const commentStatsMap = new Map<
			number,
			{
				commentCount: number;
				emailCount: number;
				emails: string[];
				ips: string[];
				userAgents: string[];
			}
		>();
		for (const row of commentStatsRows) {
			if (row.visitorId === null) {
				continue;
			}

			commentStatsMap.set(row.visitorId, {
				commentCount: Number(row.commentCount ?? 0),
				emailCount: Number(row.emailCount ?? 0),
				emails: Array.from(new Set(parseStringArray(row.emailsJson))),
				ips: Array.from(new Set(parseStringArray(row.ipsJson))),
				userAgents: Array.from(new Set(parseStringArray(row.userAgentsJson))),
			});
		}
		const metadataByVisitorId = new Map<number, RequestMetaAggregateSource[]>();
		if (visitorIds.length > 0) {
			const metadataRows = await this.db
				.select({
					visitorId: visitorRequestMetadata.visitorId,
					ip: visitorRequestMetadata.ip,
					userAgent: visitorRequestMetadata.userAgent,
					ipCountry: visitorRequestMetadata.ipCountry,
					ipRegion: visitorRequestMetadata.ipRegion,
					ipCity: visitorRequestMetadata.ipCity,
					ipIsp: visitorRequestMetadata.ipIsp,
					ipLocationSource: visitorRequestMetadata.ipLocationSource,
					ipLocationUpdatedAt: visitorRequestMetadata.ipLocationUpdatedAt,
					ipLocationError: visitorRequestMetadata.ipLocationError,
					deviceBrowser: visitorRequestMetadata.deviceBrowser,
					deviceBrowserVersion: visitorRequestMetadata.deviceBrowserVersion,
					deviceOs: visitorRequestMetadata.deviceOs,
					deviceOsVersion: visitorRequestMetadata.deviceOsVersion,
					deviceType: visitorRequestMetadata.deviceType,
					deviceIcon: visitorRequestMetadata.deviceIcon,
					deviceSource: visitorRequestMetadata.deviceSource,
					deviceUpdatedAt: visitorRequestMetadata.deviceUpdatedAt,
					deviceError: visitorRequestMetadata.deviceError,
					lastSeenAt: visitorRequestMetadata.lastSeenAt,
					seenCount: visitorRequestMetadata.seenCount,
				})
				.from(visitorRequestMetadata)
				.where(inArray(visitorRequestMetadata.visitorId, visitorIds))
				.orderBy(desc(visitorRequestMetadata.lastSeenAt));
			for (const row of metadataRows) {
				const records = metadataByVisitorId.get(row.visitorId) ?? [];
				records.push({
					ip: row.ip,
					userAgent: row.userAgent,
					ipCountry: row.ipCountry,
					ipRegion: row.ipRegion,
					ipCity: row.ipCity,
					ipIsp: row.ipIsp,
					ipLocationSource: row.ipLocationSource,
					ipLocationUpdatedAt: row.ipLocationUpdatedAt,
					ipLocationError: row.ipLocationError,
					deviceBrowser: row.deviceBrowser,
					deviceBrowserVersion: row.deviceBrowserVersion,
					deviceOs: row.deviceOs,
					deviceOsVersion: row.deviceOsVersion,
					deviceType: row.deviceType,
					deviceIcon: row.deviceIcon,
					deviceSource: row.deviceSource,
					deviceUpdatedAt: row.deviceUpdatedAt,
					deviceError: row.deviceError,
					count: Number(row.seenCount ?? 1),
				});
				metadataByVisitorId.set(row.visitorId, records);
			}
		}

		const items = rows.map((row) => {
			const commentStats = commentStatsMap.get(row.id);
			const ips = commentStats?.ips ?? [];
			const metadataRows = metadataByVisitorId.get(row.id) ?? [];
			const lastRequestMeta = buildRequestMeta(
				metadataRows[0] ?? {
					ip: row.lastIp,
					userAgent: row.lastUserAgent,
				},
			);
			const lastIp = row.lastIp ?? metadataRows[0]?.ip ?? null;
			const blacklist = {
				ip: ipRules.some((rule) =>
					matchBlacklistRule(
						{
							targetType: rule.targetType,
							targetValue: rule.targetValue,
							matchMode: rule.matchMode,
						},
						{ ip: lastIp ?? undefined },
					),
				),
				visitor: visitorRules.some((rule) =>
					matchBlacklistRule(
						{
							targetType: rule.targetType,
							targetValue: rule.targetValue,
							matchMode: rule.matchMode,
						},
						{ visitorKey: row.visitorKey },
					),
				),
			};

			return {
				siteKey: row.siteKey,
				visitorKey: row.visitorKey,
				lastIp,
				lastUserAgent: row.lastUserAgent,
				lastSeenPageKey: row.lastSeenPageKey,
				lastSeenPageUrl: resolvePublicPageUrl(
					row.lastSeenPageUrl,
					parseStringArray(row.allowedOriginsJson),
				),
				lastSeenAt: row.lastSeenAt,
				createdAt: row.createdAt,
				commentCount: commentStats?.commentCount ?? 0,
				pageCount: pageCountMap.get(row.id) ?? 0,
				emailCount: commentStats?.emailCount ?? 0,
				emails: commentStats?.emails ?? [],
				ips,
				userAgents: commentStats?.userAgents ?? [],
				lastRequestMeta,
				ipLocations: aggregateIpLocations(metadataRows),
				devices: aggregateDevices(metadataRows),
				blacklist,
			};
		});
		return {
			items,
			totalCount,
		};
	}

	public async listSitesSummary() {
		const rows = await this.db
			.select({
				siteId: sites.id,
				siteKey: sites.siteKey,
				name: sites.name,
				allowedOriginsJson: sites.allowedOriginsJson,
				commentsEnabled: siteSettings.commentsEnabled,
				defaultStatus: siteSettings.defaultStatus,
				commentRequireJson: siteSettings.commentRequireJson,
				commentInputLimitsJson: siteSettings.commentInputLimitsJson,
				allowWebsite: siteSettings.allowWebsite,
				captchaMode: siteSettings.captchaMode,
				moderationJson: siteSettings.moderationJson,
				allowPageLike: siteSettings.allowPageLike,
				engagementJson: siteSettings.engagementJson,
				commenterReplyEmailEnabled: siteSettings.commenterReplyEmailEnabled,
				commenterReplyEmailDefaultChecked:
					siteSettings.commenterReplyEmailDefaultChecked,
				backendNotificationsEnabled: siteSettings.backendNotificationsEnabled,
			})
			.from(sites)
			.innerJoin(siteSettings, eq(siteSettings.siteId, sites.id))
			.orderBy(sites.siteKey);

		const siteIds = rows.map((row) => row.siteId);
		if (siteIds.length === 0) {
			return [];
		}

		const pageCountMap = toCountMap(
			await this.db
				.select({
					key: pageThreads.siteId,
					value: count(),
				})
				.from(pageThreads)
				.where(
					and(
						inArray(pageThreads.siteId, siteIds),
						eq(pageThreads.kind, "public"),
					),
				)
				.groupBy(pageThreads.siteId),
		);
		const commentCountMap = toCountMap(
			await this.db
				.select({
					key: comments.siteId,
					value: count(),
				})
				.from(comments)
				.innerJoin(pageThreads, eq(pageThreads.id, comments.pageThreadId))
				.where(
					and(
						inArray(comments.siteId, siteIds),
						isNull(comments.deletedAt),
						eq(pageThreads.kind, "public"),
					),
				)
				.groupBy(comments.siteId),
		);
		const commenterCountMap = toCountMap(
			await this.db
				.select({
					key: comments.siteId,
					value: sql<number>`COUNT(DISTINCT ${comments.authorEmail})`,
				})
				.from(comments)
				.innerJoin(pageThreads, eq(pageThreads.id, comments.pageThreadId))
				.where(
					and(
						inArray(comments.siteId, siteIds),
						isNull(comments.deletedAt),
						isNotNull(comments.authorEmail),
						eq(pageThreads.kind, "public"),
					),
				)
				.groupBy(comments.siteId),
		);
		const visitorCountMap = toCountMap(
			await this.db
				.select({
					key: visitors.siteId,
					value: count(),
				})
				.from(visitors)
				.where(inArray(visitors.siteId, siteIds))
				.groupBy(visitors.siteId),
		);

		return rows.map((row) => ({
			siteKey: row.siteKey,
			name: row.name,
			allowedOrigins: parseStringArray(row.allowedOriginsJson),
			comments: {
				enabled: row.commentsEnabled,
				defaultStatus: row.defaultStatus,
				commentRequireJson: row.commentRequireJson,
				commentInputLimitsJson: row.commentInputLimitsJson,
				allowWebsite: row.allowWebsite,
				captcha: {
					mode: row.captchaMode,
				},
				moderationJson: row.moderationJson,
			},
			pageFeedback: {
				allowLike: row.allowPageLike,
			},
			engagement: buildAdminEngagementSummary(
				parseEngagementSettings(row.engagementJson),
			),
			notifications: {
				commenter: {
					replyEmailEnabled: row.commenterReplyEmailEnabled,
					replyEmailDefaultChecked: row.commenterReplyEmailDefaultChecked,
				},
				backend: {
					enabled: row.backendNotificationsEnabled,
				},
			},
			pageCount: pageCountMap.get(row.siteId) ?? 0,
			commentCount: commentCountMap.get(row.siteId) ?? 0,
			commenterCount: commenterCountMap.get(row.siteId) ?? 0,
			visitorCount: visitorCountMap.get(row.siteId) ?? 0,
		}));
	}

	public async getCommentById(commentId: string) {
		const [comment] = await this.db
			.select()
			.from(comments)
			.where(eq(comments.id, commentId))
			.limit(1);

		return comment;
	}

	public async listCommentsByIds(commentIds: string[]) {
		if (commentIds.length === 0) {
			return [];
		}
		return this.db
			.select()
			.from(comments)
			.where(inArray(comments.id, commentIds));
	}

	public async getCommentRequestMetadata(commentId: string) {
		const [metadata] = await this.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, commentId))
			.limit(1);

		return metadata;
	}

	public async updateCommentIpLocation(
		commentId: string,
		input: {
			country?: string | null;
			region?: string | null;
			city?: string | null;
			isp?: string | null;
			raw?: string | null;
			source?: string | null;
			dbHash?: string | null;
			error?: string | null;
		},
	) {
		const nowIso = new Date().toISOString();
		await this.db
			.update(commentRequestMetadata)
			.set({
				ipCountry: input.country,
				ipRegion: input.region,
				ipCity: input.city,
				ipIsp: input.isp,
				ipLocationRaw: input.raw,
				ipLocationSource: input.source,
				ipLocationDbHash: input.dbHash,
				ipLocationUpdatedAt: nowIso,
				ipLocationError: input.error,
				updatedAt: nowIso,
			})
			.where(eq(commentRequestMetadata.commentId, commentId));

		return this.getCommentRequestMetadata(commentId);
	}

	public async getCommentReplyContext(commentId: string) {
		const [row] = await this.db
			.select({
				commentId: comments.id,
				pageThreadId: comments.pageThreadId,
				siteId: comments.siteId,
				siteKey: sites.siteKey,
				pageKey: pageThreads.pageKey,
				verifiedAuthorJson: siteSettings.verifiedAuthorJson,
				staffDisplayJson: siteSettings.staffDisplayJson,
				moderationJson: siteSettings.moderationJson,
			})
			.from(comments)
			.innerJoin(sites, eq(sites.id, comments.siteId))
			.innerJoin(pageThreads, eq(pageThreads.id, comments.pageThreadId))
			.innerJoin(siteSettings, eq(siteSettings.siteId, sites.id))
			.where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
			.limit(1);

		return row;
	}

	public async updateComment(
		commentId: string,
		input: {
			status?: CommentStatus;
			isPinned?: boolean;
			isFolded?: boolean;
			contentRaw?: string;
			actorUserId?: number;
		},
	) {
		return this.db.transaction(async (tx) => {
			const [previous] = await tx
				.select()
				.from(comments)
				.where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
				.for("update")
				.limit(1);
			if (!previous) return undefined;
			const status = input.status ?? (previous.status as CommentStatus);
			const contentChanged =
				input.contentRaw !== undefined &&
				input.contentRaw !== previous.contentRaw;
			const changed = status !== previous.status || contentChanged;
			const nowIso = new Date().toISOString();
			if (input.actorUserId && changed)
				await requireCommentAccount(tx, input.actorUserId, previous.siteId);
			const approval = changed
				? {
						approvedAt:
							status === "approved" && input.actorUserId ? nowIso : null,
						approvalSource:
							status === "approved" && input.actorUserId ? "manual" : null,
						approvedByUserId:
							status === "approved" ? (input.actorUserId ?? null) : null,
					}
				: {};
			await tx
				.update(comments)
				.set({
					status,
					isPinned: input.isPinned,
					isFolded: input.isFolded,
					contentRaw: input.contentRaw,
					contentHtml:
						input.contentRaw !== undefined
							? renderCommentHtml(input.contentRaw)
							: undefined,
					updatedAt: nowIso,
					...approval,
				})
				.where(eq(comments.id, commentId));
			if (changed) {
				await tx.insert(commentReviewEvents).values({
					commentId,
					actorUserId: input.actorUserId,
					previousStatus: previous.status,
					status,
					contentChanged,
					effectiveAt: nowIso,
				});
				const [site] = await tx
					.select()
					.from(sites)
					.where(eq(sites.id, previous.siteId))
					.limit(1);
				const [thread] = await tx
					.select()
					.from(pageThreads)
					.where(eq(pageThreads.id, previous.pageThreadId))
					.limit(1);
				if (site && thread)
					await enqueueCommentNotificationIntent(tx, {
						source: "admin_moderation",
						siteId: previous.siteId,
						siteKey: site.siteKey,
						commentId,
						pageKey: thread.pageKey,
						status: status as CommentStatus,
						previousStatus: previous.status as CommentStatus,
						authorUserId: previous.authorUserId,
						contentRaw: input.contentRaw ?? previous.contentRaw,
						createdAt: previous.createdAt,
						actorType: input.actorUserId ? "admin_user" : "system",
						actorId: input.actorUserId ? String(input.actorUserId) : undefined,
						notifyBackend: true,
						notifyReply: Boolean(
							previous.parentId &&
								previous.status !== "approved" &&
								status === "approved",
						),
					});
			}
			return new AdminRepository(tx).getCommentById(commentId);
		});
	}

	public async bulkUpdateComments(
		commentIds: string[],
		input: {
			status?: CommentStatus;
			isPinned?: boolean;
			isFolded?: boolean;
			contentRaw?: string;
			actorUserId?: number;
		},
	) {
		return this.db.transaction(async (tx) => {
			const updated: Array<
				NonNullable<Awaited<ReturnType<AdminRepository["getCommentById"]>>>
			> = [];
			const repository = new AdminRepository(tx);
			for (const commentId of [...new Set(commentIds)].sort()) {
				const comment = await repository.updateComment(commentId, input);
				if (comment) updated.push(comment);
			}
			const byId = new Map(updated.map((comment) => [comment.id, comment]));
			return commentIds.flatMap((id) => {
				const comment = byId.get(id);
				return comment ? [comment] : [];
			});
		});
	}

	public async moveCommentsToTrash(commentIds: string[]) {
		if (commentIds.length === 0) {
			return [];
		}

		const existingComments = await this.db
			.select()
			.from(comments)
			.where(and(inArray(comments.id, commentIds), isNull(comments.deletedAt)));
		if (existingComments.length === 0) {
			return [];
		}

		const existingIds = existingComments.map((comment) => comment.id);
		await this.db
			.update(comments)
			.set({
				status: "trash",
				updatedAt: new Date().toISOString(),
			})
			.where(inArray(comments.id, existingIds));

		const movedComments = await this.db
			.select()
			.from(comments)
			.where(inArray(comments.id, existingIds));
		const movedById = new Map(
			movedComments.map((comment) => [comment.id, comment]),
		);

		return commentIds.flatMap((commentId) => {
			const comment = movedById.get(commentId);
			return comment ? [comment] : [];
		});
	}

	public async permanentlyDeleteComment(commentId: string) {
		return this.db.transaction(async (transaction) => {
			const now = new Date().toISOString();
			const [deletedComment] = await transaction
				.update(comments)
				.set({
					deletedAt: now,
					updatedAt: now,
				})
				.where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
				.returning();
			if (!deletedComment) {
				return new AdminRepository(transaction).getCommentById(commentId);
			}

			if (deletedComment.parentId) {
				await transaction
					.update(comments)
					.set({
						replyCount: sql`GREATEST(${comments.replyCount} - 1, 0)`,
						updatedAt: now,
					})
					.where(eq(comments.id, deletedComment.parentId));
			}

			await transaction
				.update(pageThreads)
				.set({
					commentCount: sql`GREATEST(${pageThreads.commentCount} - 1, 0)`,
					rootCommentCount: deletedComment.parentId
						? sql`${pageThreads.rootCommentCount}`
						: sql`GREATEST(${pageThreads.rootCommentCount} - 1, 0)`,
					updatedAt: now,
				})
				.where(eq(pageThreads.id, deletedComment.pageThreadId));
			return deletedComment;
		});
	}

	public async clearTrash(siteId?: number) {
		const trashedComments = await this.db
			.select()
			.from(comments)
			.where(
				and(
					eq(comments.status, "trash"),
					isNull(comments.deletedAt),
					siteId === undefined ? undefined : eq(comments.siteId, siteId),
				),
			);

		for (const comment of trashedComments) {
			await this.permanentlyDeleteComment(comment.id);
		}

		return trashedComments.length;
	}

	public async listBlacklist(input: {
		siteId?: number;
		search?: string;
		limit: number;
		offset: number;
	}) {
		const searchValue = input.search ? `%${input.search}%` : undefined;
		const whereCondition = and(
			input.siteId ? eq(blacklistRules.siteId, input.siteId) : undefined,
			searchValue
				? or(
						ilike(blacklistRules.targetValue, searchValue),
						ilike(blacklistRules.reason, searchValue),
						ilike(blacklistRules.targetType, searchValue),
						ilike(blacklistRules.matchMode, searchValue),
					)
				: undefined,
		);
		const rows = await this.db
			.select()
			.from(blacklistRules)
			.where(whereCondition)
			.orderBy(desc(blacklistRules.createdAt), desc(blacklistRules.id))
			.limit(input.limit)
			.offset(input.offset);
		const [total] = await this.db
			.select({
				value: count(),
			})
			.from(blacklistRules)
			.where(whereCondition);

		return {
			items: rows,
			totalCount: total?.value ?? 0,
		};
	}

	public async createBlacklistRule(input: {
		siteId?: number;
		targetType: "ip" | "email" | "visitor";
		matchMode: "exact" | "cidr" | "wildcard";
		targetValue: string;
		scope: "post" | "all";
		reason?: string;
		source?: string;
		expiresAt?: string;
	}) {
		await this.db.insert(blacklistRules).values({
			siteId: input.siteId,
			scope: input.scope,
			targetType: input.targetType,
			targetValue:
				input.targetType === "email"
					? input.targetValue.trim().toLowerCase()
					: input.targetValue,
			matchMode: input.matchMode,
			reason: input.reason,
			source: input.source ?? "manual",
			expiresAt: input.expiresAt,
		});

		const [rule] = await this.db
			.select()
			.from(blacklistRules)
			.orderBy(desc(blacklistRules.id))
			.limit(1);

		return rule;
	}

	public async deleteBlacklistRule(ruleId: number) {
		const [rule] = await this.db
			.select()
			.from(blacklistRules)
			.where(eq(blacklistRules.id, ruleId))
			.limit(1);
		if (!rule) {
			return undefined;
		}

		const penalty = await new AbuseRepository(this.db).release({
			ruleId,
			kind: "released",
			reason: "管理员提前解除",
		});
		if (!penalty)
			await this.db.delete(blacklistRules).where(eq(blacklistRules.id, ruleId));
		return rule;
	}

	public async getBlacklistRule(ruleId: number) {
		const [rule] = await this.db
			.select()
			.from(blacklistRules)
			.where(eq(blacklistRules.id, ruleId))
			.limit(1);
		return rule;
	}

	public async deleteBlacklistRulesByTarget(input: {
		siteId?: number;
		targetType: "ip" | "email" | "visitor";
		targetValue: string;
		matchMode: "exact" | "cidr" | "wildcard";
	}) {
		const targetValue =
			input.targetType === "email"
				? input.targetValue.trim().toLowerCase()
				: input.targetValue;
		const rules = await this.db
			.select()
			.from(blacklistRules)
			.where(
				and(
					input.siteId === undefined
						? isNull(blacklistRules.siteId)
						: eq(blacklistRules.siteId, input.siteId),
					eq(blacklistRules.targetType, input.targetType),
					eq(blacklistRules.targetValue, targetValue),
					eq(blacklistRules.matchMode, input.matchMode),
				),
			);
		if (rules.length === 0) {
			return [];
		}

		for (const rule of rules) await this.deleteBlacklistRule(rule.id);

		return rules;
	}

	public async listAllowlistRules(input: {
		siteId?: number;
		targetType?: "ip" | "email" | "visitor";
		search?: string;
		limit: number;
		offset: number;
	}) {
		const searchValue = input.search ? `%${input.search}%` : undefined;
		const whereCondition = and(
			isNull(allowlistRules.deletedAt),
			input.siteId ? eq(allowlistRules.siteId, input.siteId) : undefined,
			input.targetType
				? eq(allowlistRules.targetType, input.targetType)
				: undefined,
			searchValue
				? or(
						ilike(allowlistRules.targetValue, searchValue),
						ilike(allowlistRules.reason, searchValue),
						ilike(allowlistRules.targetType, searchValue),
						ilike(allowlistRules.matchMode, searchValue),
					)
				: undefined,
		);
		const rows = await this.db
			.select()
			.from(allowlistRules)
			.where(whereCondition)
			.orderBy(desc(allowlistRules.createdAt), desc(allowlistRules.id))
			.limit(input.limit)
			.offset(input.offset);
		const [total] = await this.db
			.select({
				value: count(),
			})
			.from(allowlistRules)
			.where(whereCondition);

		return {
			items: rows,
			totalCount: total?.value ?? 0,
		};
	}

	public async createAllowlistRule(input: {
		siteId?: number;
		targetType: "ip" | "email" | "visitor";
		matchMode: "exact" | "cidr" | "domain";
		targetValue: string;
		scope: "post" | "all";
		reason?: string;
		expiresAt?: string;
		createdByUserId?: number;
	}) {
		await this.db.insert(allowlistRules).values({
			siteId: input.siteId,
			scope: input.scope,
			targetType: input.targetType,
			targetValue:
				input.targetType === "email"
					? input.targetValue.trim().toLowerCase()
					: input.targetValue.trim(),
			matchMode: input.matchMode,
			reason: input.reason,
			expiresAt: input.expiresAt,
			createdByUserId: input.createdByUserId,
		});

		const [rule] = await this.db
			.select()
			.from(allowlistRules)
			.orderBy(desc(allowlistRules.id))
			.limit(1);

		return rule;
	}

	public async getAllowlistRule(ruleId: number) {
		const [rule] = await this.db
			.select()
			.from(allowlistRules)
			.where(
				and(eq(allowlistRules.id, ruleId), isNull(allowlistRules.deletedAt)),
			)
			.limit(1);
		return rule;
	}

	public async updateAllowlistRule(
		ruleId: number,
		input: {
			targetType?: "ip" | "email" | "visitor";
			matchMode?: "exact" | "cidr" | "domain";
			targetValue?: string;
			scope?: "post" | "all";
			reason?: string | null;
			expiresAt?: string | null;
		},
	) {
		const existingRule = await this.getAllowlistRule(ruleId);
		if (!existingRule) {
			return undefined;
		}
		const targetType = input.targetType ?? existingRule.targetType;
		await this.db
			.update(allowlistRules)
			.set({
				targetType: input.targetType,
				matchMode: input.matchMode,
				targetValue:
					input.targetValue === undefined
						? undefined
						: targetType === "email"
							? input.targetValue.trim().toLowerCase()
							: input.targetValue.trim(),
				scope: input.scope,
				reason: input.reason,
				expiresAt: input.expiresAt,
				updatedAt: new Date().toISOString(),
			})
			.where(
				and(eq(allowlistRules.id, ruleId), isNull(allowlistRules.deletedAt)),
			);

		return this.getAllowlistRule(ruleId);
	}

	public async deleteAllowlistRule(ruleId: number) {
		const rule = await this.getAllowlistRule(ruleId);
		if (!rule) {
			return undefined;
		}

		await this.db
			.update(allowlistRules)
			.set({
				deletedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(allowlistRules.id, ruleId));
		return rule;
	}

	public async getSiteSettings(siteId: number) {
		const [settings] = await this.db
			.select()
			.from(siteSettings)
			.where(eq(siteSettings.siteId, siteId))
			.limit(1);

		return settings;
	}

	public async listSiteNotificationEvents(siteId: number) {
		return new SiteNotificationEventsRepository(this.db).listSiteEvents(siteId);
	}

	public async listNotificationChannelConfigs() {
		return new NotificationChannelConfigsRepository(this.db).list();
	}

	public async updateSiteSettings(
		siteId: number,
		input: {
			commentsEnabled?: boolean;
			defaultStatus?: "pending" | "approved";
			maxDepth?: number;
			rootLimit?: number;
			commentRequireJson?: string;
			allowWebsite?: boolean;
			allowPageLike?: boolean;
			captchaMode?: "never" | "always" | "threshold";
			captchaThresholdWindowSec?: number;
			captchaThresholdMaxActions?: number;
			abuseGuardEnabled?: boolean;
			abuseGuardWindowSec?: number;
			abuseGuardMaxWriteActions?: number;
			autoBlacklistEnabled?: boolean;
			autoBlacklistScope?: "post" | "all";
			autoBlacklistTtlSec?: number;
			commentInputLimitsJson?: string;
			commentMetadataJson?: string;
			verifiedAuthorJson?: string;
			staffDisplayJson?: string;
			moderationJson?: string;
			emailPolicyJson?: string;
			abusePolicyJson?: string;
			pageRegistryJson?: string;
			engagementJson?: string;
			commenterReplyEmailEnabled?: boolean;
			commenterReplyEmailDefaultChecked?: boolean;
			backendNotificationsEnabled?: boolean;
			notificationEvents?: SiteNotificationEventInput[];
		},
	) {
		const values = {
			commentsEnabled: input.commentsEnabled,
			defaultStatus: input.defaultStatus,
			maxDepth: input.maxDepth,
			rootLimit: input.rootLimit,
			commentRequireJson: input.commentRequireJson,
			allowWebsite: input.allowWebsite,
			allowPageLike: input.allowPageLike,
			captchaMode: input.captchaMode,
			captchaThresholdWindowSec: input.captchaThresholdWindowSec,
			captchaThresholdMaxActions: input.captchaThresholdMaxActions,
			abuseGuardEnabled: input.abuseGuardEnabled,
			abuseGuardWindowSec: input.abuseGuardWindowSec,
			abuseGuardMaxWriteActions: input.abuseGuardMaxWriteActions,
			autoBlacklistEnabled: input.autoBlacklistEnabled,
			autoBlacklistScope: input.autoBlacklistScope,
			autoBlacklistTtlSec: input.autoBlacklistTtlSec,
			commentInputLimitsJson: input.commentInputLimitsJson,
			commentMetadataJson: input.commentMetadataJson,
			verifiedAuthorJson: input.verifiedAuthorJson,
			staffDisplayJson: input.staffDisplayJson,
			moderationJson: input.moderationJson,
			emailPolicyJson: input.emailPolicyJson,
			abusePolicyJson: input.abusePolicyJson,
			pageRegistryJson: input.pageRegistryJson,
			engagementJson: input.engagementJson,
			commenterReplyEmailEnabled: input.commenterReplyEmailEnabled,
			commenterReplyEmailDefaultChecked:
				input.commenterReplyEmailDefaultChecked,
			backendNotificationsEnabled: input.backendNotificationsEnabled,
			updatedAt: new Date().toISOString(),
		};
		const notificationEvents = input.notificationEvents;
		if (notificationEvents) {
			await new SiteNotificationEventsRepository(this.db).replaceSiteEvents(
				{
					siteId,
					events: notificationEvents,
				},
				{
					beforeReplace: async (transaction) => {
						await transaction
							.update(siteSettings)
							.set(values)
							.where(eq(siteSettings.siteId, siteId));
					},
				},
			);
		} else {
			await this.db
				.update(siteSettings)
				.set(values)
				.where(eq(siteSettings.siteId, siteId));
		}

		return this.getSiteSettings(siteId);
	}
}
