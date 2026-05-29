import {
	and,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	like,
	or,
	sql,
} from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	adminSessions,
	blacklistRules,
	commentRequestMetadata,
	comments,
	pageThreads,
	pageViewSessions,
	sitePageRegistry,
	siteSettings,
	sites,
	visitors,
} from "../../db/schema";
import { buildExternalAvatarUrl } from "../comments/gravatar";
import type { CommentStatus } from "../comments/moderation-types";
import { matchBlacklistRule } from "../shared/blacklist-match";
import { hashCommentEmail, renderCommentHtml } from "../shared/comment-content";
import { resolvePublicPageUrl } from "../shared/page-url";
import { buildDefaultSiteSettings } from "../shared/site-settings-defaults";
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

type AdminPageSortBy =
	| "updatedAt"
	| "createdAt"
	| "commentCount"
	| "visitorCount"
	| "userCount"
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
	userCount: number;
}

function comparePageSortValue(
	left: AdminPageItem,
	right: AdminPageItem,
	sortBy: AdminPageSortBy,
) {
	if (sortBy === "title") {
		return (left.pageTitle ?? "").localeCompare(right.pageTitle ?? "");
	}
	if (sortBy === "pageKey") {
		return left.pageKey.localeCompare(right.pageKey);
	}
	if (sortBy === "createdAt" || sortBy === "updatedAt") {
		return (left[sortBy] ?? "").localeCompare(right[sortBy] ?? "");
	}
	return Number(left[sortBy] ?? 0) - Number(right[sortBy] ?? 0);
}

export class AdminRepository {
	public constructor(private readonly db: AppDatabase) {}

	public get database(): AppDatabase {
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
			userTotal,
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
				.from(pageThreads),
			this.db
				.select({
					value: count(),
				})
				.from(comments)
				.where(isNull(comments.deletedAt)),
			this.db
				.select({
					value: count(),
				})
				.from(comments)
				.where(and(isNull(comments.deletedAt), eq(comments.status, "pending"))),
			this.db
				.select({
					value: sql<number>`COUNT(DISTINCT ${comments.authorEmail})`,
				})
				.from(comments)
				.where(isNotNull(comments.authorEmail)),
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
			userCount: Number(userTotal[0]?.value ?? 0),
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
		siteId?: number;
		pageKey?: string;
		status?: CommentStatus;
		statusGroup?: "hidden";
		avatar?: SystemSettings["avatar"];
		search?: string;
		limit: number;
		offset: number;
	}) {
		const hasExplicitStatusFilter = Boolean(input.status || input.statusGroup);
		const conditions = [
			input.siteId ? eq(comments.siteId, input.siteId) : undefined,
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
						like(comments.authorName, `%${input.search}%`),
						like(comments.contentRaw, `%${input.search}%`),
						emailHash ? eq(comments.authorEmailHash, emailHash) : undefined,
					);

		const pageKeyCondition =
			input.pageKey === undefined
				? undefined
				: sql`${comments.pageThreadId} IN (SELECT id FROM ${pageThreads} WHERE ${pageThreads.pageKey} = ${input.pageKey})`;

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
				contentRaw: comments.contentRaw,
				isPinned: comments.isPinned,
				isFolded: comments.isFolded,
				replyCount: comments.replyCount,
				voteUpCount: comments.voteUpCount,
				voteDownCount: comments.voteDownCount,
				createdAt: comments.createdAt,
				updatedAt: comments.updatedAt,
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
		const rows = await this.db
			.select({
				id: sitePageRegistry.id,
				pageThreadId: pageThreads.id,
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
				trashedAt: sitePageRegistry.trashedAt,
				deletedAt: sitePageRegistry.deletedAt,
				createdAt: sitePageRegistry.createdAt,
				threadPageTitle: pageThreads.pageTitle,
				threadPageUrl: pageThreads.pageUrl,
				commentCount: pageThreads.commentCount,
				rootCommentCount: pageThreads.rootCommentCount,
				pageLikeCount: pageThreads.pageLikeCount,
				updatedAt: sitePageRegistry.updatedAt,
			})
			.from(sitePageRegistry)
			.innerJoin(sites, eq(sites.id, sitePageRegistry.siteId))
			.leftJoin(
				pageThreads,
				and(
					eq(pageThreads.siteId, sitePageRegistry.siteId),
					eq(pageThreads.pageKey, sitePageRegistry.pageKey),
				),
			)
			.where(
				and(
					input.siteId ? eq(sitePageRegistry.siteId, input.siteId) : undefined,
					input.status ? eq(sitePageRegistry.status, input.status) : undefined,
					searchValue
						? or(
								like(sitePageRegistry.pageKey, searchValue),
								like(sitePageRegistry.title, searchValue),
								like(sitePageRegistry.pageUrl, searchValue),
							)
						: undefined,
				),
			)
			.orderBy(desc(sitePageRegistry.updatedAt));

		const pageThreadIds = rows
			.map((row) => row.pageThreadId)
			.filter((id): id is number => id !== null);
		if (pageThreadIds.length === 0) {
			const items: AdminPageItem[] = rows.map((row) => ({
				siteKey: row.siteKey,
				pageKey: row.pageKey,
				status: row.status,
				pageTitle: row.pageTitle ?? row.threadPageTitle,
				pageUrl: resolvePublicPageUrl(
					row.pageUrl ?? row.threadPageUrl,
					parseStringArray(row.allowedOriginsJson),
				),
				commentCount: 0,
				rootCommentCount: 0,
				pageLikeCount: 0,
				updatedAt: row.updatedAt,
				createdAt: row.createdAt,
				trashedAt: row.trashedAt,
				deletedAt: row.deletedAt,
				titleRefreshAttemptedAt: row.titleRefreshAttemptedAt,
				titleRefreshedAt: row.titleRefreshedAt,
				titleRefreshStatusCode: row.titleRefreshStatusCode,
				titleRefreshError: row.titleRefreshError,
				visitorCount: 0,
				userCount: 0,
			}));
			const direction = input.sortOrder === "asc" ? 1 : -1;
			const sortedItems = items.sort(
				(left, right) =>
					comparePageSortValue(left, right, input.sortBy) * direction,
			);
			return {
				items: sortedItems.slice(input.offset, input.offset + input.limit),
				totalCount: sortedItems.length,
			};
		}

		const visitorCounts = toCountMap(
			await this.db
				.select({
					key: pageViewSessions.pageThreadId,
					value: sql<number>`COUNT(DISTINCT ${pageViewSessions.visitorId})`,
				})
				.from(pageViewSessions)
				.where(inArray(pageViewSessions.pageThreadId, pageThreadIds))
				.groupBy(pageViewSessions.pageThreadId),
		);
		const userCounts = toCountMap(
			await this.db
				.select({
					key: comments.pageThreadId,
					value: sql<number>`COUNT(DISTINCT ${comments.authorEmail})`,
				})
				.from(comments)
				.where(
					and(
						inArray(comments.pageThreadId, pageThreadIds),
						isNull(comments.deletedAt),
						isNotNull(comments.authorEmail),
					),
				)
				.groupBy(comments.pageThreadId),
		);

		const items: AdminPageItem[] = rows.map((row) => ({
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
			visitorCount:
				row.pageThreadId === null
					? 0
					: (visitorCounts.get(row.pageThreadId) ?? 0),
			userCount:
				row.pageThreadId === null ? 0 : (userCounts.get(row.pageThreadId) ?? 0),
		}));
		const direction = input.sortOrder === "asc" ? 1 : -1;
		const sortedItems = items.sort(
			(left, right) =>
				comparePageSortValue(left, right, input.sortBy) * direction,
		);
		return {
			items: sortedItems.slice(input.offset, input.offset + input.limit),
			totalCount: sortedItems.length,
		};
	}

	public async listUsers(input: {
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
				emailVariantsJson: sql<string>`json_group_array(DISTINCT ${comments.authorEmail})`,
				namesJson: sql<string>`json_group_array(DISTINCT ${comments.authorName})`,
				commentCount: count(),
				pendingCount: sql<number>`SUM(CASE WHEN ${comments.status} = 'pending' THEN 1 ELSE 0 END)`,
				approvedCount: sql<number>`SUM(CASE WHEN ${comments.status} = 'approved' THEN 1 ELSE 0 END)`,
				lastCommentAt: sql<string>`MAX(${comments.createdAt})`,
				pageCount: sql<number>`COUNT(DISTINCT ${comments.pageThreadId})`,
				siteCount: sql<number>`COUNT(DISTINCT ${comments.siteId})`,
				ipsJson: sql<string>`json_group_array(DISTINCT ${commentRequestMetadata.authorIp})`,
				userAgentsJson: sql<string>`json_group_array(DISTINCT ${commentRequestMetadata.authorUserAgent})`,
			})
			.from(comments)
			.leftJoin(
				commentRequestMetadata,
				eq(commentRequestMetadata.commentId, comments.id),
			)
			.where(
				and(
					isNull(comments.deletedAt),
					isNotNull(comments.authorEmail),
					input.siteId ? eq(comments.siteId, input.siteId) : undefined,
					searchValue
						? or(
								like(normalizedEmail, searchValue),
								like(comments.authorName, searchValue),
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
				const ips = parseStringArray(row.ipsJson);
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
					emailVariants: parseStringArray(row.emailVariantsJson),
					names: parseStringArray(row.namesJson),
					commentCount: Number(row.commentCount ?? 0),
					pendingCount: Number(row.pendingCount ?? 0),
					approvedCount: Number(row.approvedCount ?? 0),
					lastCommentAt: row.lastCommentAt,
					pageCount: Number(row.pageCount ?? 0),
					siteCount: Number(row.siteCount ?? 0),
					ips,
					userAgents: parseStringArray(row.userAgentsJson),
					blacklist: {
						email: emailBlacklisted,
					},
					isBlacklisted: emailBlacklisted,
				};
			})
			.sort((left, right) =>
				(right.lastCommentAt ?? "").localeCompare(left.lastCommentAt ?? ""),
			);

		return {
			items: items.slice(input.offset, input.offset + input.limit),
			totalCount: items.length,
		};
	}

	public async listVisitors(input: {
		siteId?: number;
		search?: string;
		limit: number;
		offset: number;
	}) {
		const searchValue = input.search ? `%${input.search}%` : undefined;
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
			.where(
				and(
					input.siteId ? eq(visitors.siteId, input.siteId) : undefined,
					searchValue ? like(visitors.visitorKey, searchValue) : undefined,
				),
			)
			.orderBy(desc(visitors.lastSeenAt));

		const visitorIds = rows.map((row) => row.id);
		if (visitorIds.length === 0) {
			return {
				items: [],
				totalCount: 0,
			};
		}

		const commentStatsRows = await this.db
			.select({
				visitorId: comments.visitorId,
				commentCount: count(),
				emailCount: sql<number>`COUNT(DISTINCT ${comments.authorEmail})`,
				emailsJson: sql<string>`json_group_array(DISTINCT ${comments.authorEmail})`,
				ipsJson: sql<string>`json_group_array(DISTINCT ${commentRequestMetadata.authorIp})`,
				userAgentsJson: sql<string>`json_group_array(DISTINCT ${commentRequestMetadata.authorUserAgent})`,
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
				emails: parseStringArray(row.emailsJson),
				ips: parseStringArray(row.ipsJson),
				userAgents: parseStringArray(row.userAgentsJson),
			});
		}

		const visitorRules = await this.listActiveBlacklistRules(
			"visitor",
			input.siteId,
		);
		return {
			items: rows.slice(input.offset, input.offset + input.limit).map((row) => {
				const commentStats = commentStatsMap.get(row.id);
				const ips = commentStats?.ips ?? [];
				return {
					siteKey: row.siteKey,
					visitorKey: row.visitorKey,
					lastIp: row.lastIp,
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
					blacklist: {
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
					},
				};
			}),
			totalCount: rows.length,
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
				allowWebsite: siteSettings.allowWebsite,
				captchaMode: siteSettings.captchaMode,
				moderationJson: siteSettings.moderationJson,
				allowPageLike: siteSettings.allowPageLike,
				emailNotificationsEnabled: siteSettings.emailNotificationsEnabled,
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
				.where(inArray(pageThreads.siteId, siteIds))
				.groupBy(pageThreads.siteId),
		);
		const commentCountMap = toCountMap(
			await this.db
				.select({
					key: comments.siteId,
					value: count(),
				})
				.from(comments)
				.where(
					and(inArray(comments.siteId, siteIds), isNull(comments.deletedAt)),
				)
				.groupBy(comments.siteId),
		);
		const userCountMap = toCountMap(
			await this.db
				.select({
					key: comments.siteId,
					value: sql<number>`COUNT(DISTINCT ${comments.authorEmail})`,
				})
				.from(comments)
				.where(
					and(
						inArray(comments.siteId, siteIds),
						isNull(comments.deletedAt),
						isNotNull(comments.authorEmail),
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
				allowWebsite: row.allowWebsite,
				captcha: {
					mode: row.captchaMode,
				},
				moderationJson: row.moderationJson,
			},
			pageFeedback: {
				allowLike: row.allowPageLike,
			},
			notifications: {
				emailEnabled: row.emailNotificationsEnabled,
			},
			pageCount: pageCountMap.get(row.siteId) ?? 0,
			commentCount: commentCountMap.get(row.siteId) ?? 0,
			userCount: userCountMap.get(row.siteId) ?? 0,
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
		},
	) {
		await this.db
			.update(comments)
			.set({
				status: input.status,
				isPinned: input.isPinned,
				isFolded: input.isFolded,
				contentRaw: input.contentRaw,
				contentHtml: input.contentRaw
					? renderCommentHtml(input.contentRaw)
					: undefined,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(comments.id, commentId));

		return this.getCommentById(commentId);
	}

	public async bulkUpdateComments(
		commentIds: string[],
		input: {
			status?: CommentStatus;
			isPinned?: boolean;
			isFolded?: boolean;
			contentRaw?: string;
		},
	) {
		if (commentIds.length === 0) {
			return [];
		}

		await this.db
			.update(comments)
			.set({
				status: input.status,
				isPinned: input.isPinned,
				isFolded: input.isFolded,
				contentRaw: input.contentRaw,
				contentHtml: input.contentRaw
					? renderCommentHtml(input.contentRaw)
					: undefined,
				updatedAt: new Date().toISOString(),
			})
			.where(and(inArray(comments.id, commentIds), isNull(comments.deletedAt)));

		const updatedComments = await this.db
			.select()
			.from(comments)
			.where(and(inArray(comments.id, commentIds), isNull(comments.deletedAt)));
		const updatedById = new Map(
			updatedComments.map((comment) => [comment.id, comment]),
		);

		return commentIds.flatMap((commentId) => {
			const comment = updatedById.get(commentId);
			return comment ? [comment] : [];
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
		const existingComment = await this.getCommentById(commentId);
		if (!existingComment || existingComment.deletedAt) {
			return existingComment;
		}

		await this.db
			.update(comments)
			.set({
				deletedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(comments.id, commentId));

		if (existingComment.parentId) {
			await this.db
				.update(comments)
				.set({
					replyCount: sql`MAX(${comments.replyCount} - 1, 0)`,
					updatedAt: new Date().toISOString(),
				})
				.where(eq(comments.id, existingComment.parentId));
		}

		await this.db
			.update(pageThreads)
			.set({
				commentCount: sql`MAX(${pageThreads.commentCount} - 1, 0)`,
				rootCommentCount: existingComment.parentId
					? sql`${pageThreads.rootCommentCount}`
					: sql`MAX(${pageThreads.rootCommentCount} - 1, 0)`,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(pageThreads.id, existingComment.pageThreadId));

		return this.getCommentById(commentId);
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
						like(blacklistRules.targetValue, searchValue),
						like(blacklistRules.reason, searchValue),
						like(blacklistRules.targetType, searchValue),
						like(blacklistRules.matchMode, searchValue),
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

		await this.db.delete(blacklistRules).where(eq(blacklistRules.id, ruleId));
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
						: or(
								isNull(blacklistRules.siteId),
								eq(blacklistRules.siteId, input.siteId),
							),
					eq(blacklistRules.targetType, input.targetType),
					eq(blacklistRules.targetValue, targetValue),
					eq(blacklistRules.matchMode, input.matchMode),
				),
			);
		if (rules.length === 0) {
			return [];
		}

		await this.db.delete(blacklistRules).where(
			inArray(
				blacklistRules.id,
				rules.map((rule) => rule.id),
			),
		);

		return rules;
	}

	public async getSiteSettings(siteId: number) {
		const [settings] = await this.db
			.select()
			.from(siteSettings)
			.where(eq(siteSettings.siteId, siteId))
			.limit(1);

		return settings;
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
			commentMetadataJson?: string;
			verifiedAuthorJson?: string;
			staffDisplayJson?: string;
			moderationJson?: string;
			emailNotificationsEnabled?: boolean;
		},
	) {
		await this.db
			.update(siteSettings)
			.set({
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
				commentMetadataJson: input.commentMetadataJson,
				verifiedAuthorJson: input.verifiedAuthorJson,
				staffDisplayJson: input.staffDisplayJson,
				moderationJson: input.moderationJson,
				emailNotificationsEnabled: input.emailNotificationsEnabled,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(siteSettings.siteId, siteId));

		return this.getSiteSettings(siteId);
	}
}
