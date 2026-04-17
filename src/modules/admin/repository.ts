import { and, count, desc, eq, isNull, like, or, sql } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	adminSessions,
	blacklistRules,
	comments,
	pageThreads,
	runtimeSettings,
	sites,
} from "../../db/schema";
import { hashCommentEmail, renderCommentHtml } from "../shared/comment-content";

export class AdminRepository {
	public constructor(private readonly db: AppDatabase) {}

	public async listSites() {
		return this.db.select().from(sites);
	}

	public async getSiteByKey(siteKey: string) {
		const [site] = await this.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, siteKey))
			.limit(1);

		return site;
	}

	public async createAdminSession(input: {
		id: string;
		tokenHash: string;
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

	public async listComments(input: {
		siteId?: number;
		pageKey?: string;
		status?: string;
		search?: string;
		limit: number;
		offset: number;
	}) {
		const conditions = [
			input.siteId ? eq(comments.siteId, input.siteId) : undefined,
			input.status ? eq(comments.status, input.status) : undefined,
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
			})
			.from(comments)
			.innerJoin(pageThreads, eq(pageThreads.id, comments.pageThreadId))
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

		return {
			items: rows,
			totalCount: total?.value ?? 0,
		};
	}

	public async getCommentById(commentId: string) {
		const [comment] = await this.db
			.select()
			.from(comments)
			.where(eq(comments.id, commentId))
			.limit(1);

		return comment;
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

	public async softDeleteComment(commentId: string) {
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

	public async listBlacklist(siteId?: number) {
		return this.db
			.select()
			.from(blacklistRules)
			.where(siteId ? eq(blacklistRules.siteId, siteId) : undefined)
			.orderBy(desc(blacklistRules.createdAt));
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

	public async getRuntimeSettings(siteId: number) {
		const [settings] = await this.db
			.select()
			.from(runtimeSettings)
			.where(eq(runtimeSettings.siteId, siteId))
			.limit(1);

		return settings;
	}

	public async updateRuntimeSettings(
		siteId: number,
		input: {
			commentsEnabled?: boolean;
			defaultStatus?: "pending" | "approved";
			maxDepth?: number;
			rootLimit?: number;
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
			emailNotificationsEnabled?: boolean;
		},
	) {
		await this.db
			.update(runtimeSettings)
			.set({
				commentsEnabled: input.commentsEnabled,
				defaultStatus: input.defaultStatus,
				maxDepth: input.maxDepth,
				rootLimit: input.rootLimit,
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
				emailNotificationsEnabled: input.emailNotificationsEnabled,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(runtimeSettings.siteId, siteId));

		return this.getRuntimeSettings(siteId);
	}
}
