import { randomUUID } from "node:crypto";

import type { FastifyRequest } from "fastify";

import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	captchaSessions,
	comments,
	pageFeedbackRecords,
	pageThreads,
	pageViewSessions,
	siteSettings,
	visitors,
	voteRecords,
} from "../../db/schema";
import type { CaptchaService } from "../comments/captcha-service";
import type { CommentsRepository } from "../comments/repository";
import type { AdminSessionService } from "../admin/session-service";
import { AppError } from "../shared/errors";
import { buildDefaultSiteSettings } from "../shared/site-settings-defaults";

export class DevModeService {
	public constructor(
		private readonly db: AppDatabase,
		private readonly commentsRepository: CommentsRepository,
		private readonly captchaService: CaptchaService,
		private readonly adminSessionService: AdminSessionService,
	) {}

	public async requireAdminSession(request: FastifyRequest) {
		return this.adminSessionService.requireSession(request);
	}

	private async ensureSite(siteKey: "default") {
		const site = this.commentsRepository.getRegisteredSite(siteKey);
		if (!site) {
			throw new AppError(404, "SITE_NOT_FOUND", "站点不存在。");
		}

		return { site };
	}

	public async resetPageState(siteKey: "default", pageKey: string) {
		const site = this.commentsRepository.getRegisteredSite(siteKey);
		if (!site) {
			throw new AppError(404, "SITE_NOT_FOUND", "站点不存在。");
		}

		const [thread] = await this.db
			.select()
			.from(pageThreads)
			.where(
				and(eq(pageThreads.siteId, site.id), eq(pageThreads.pageKey, pageKey)),
			)
			.limit(1);

		if (thread) {
			const commentRows = await this.db
				.select({ id: comments.id })
				.from(comments)
				.where(eq(comments.pageThreadId, thread.id));
			const commentIds = commentRows.map((row) => row.id);

			if (commentIds.length > 0) {
				await this.db
					.delete(voteRecords)
					.where(inArray(voteRecords.commentId, commentIds));
			}

			await this.db
				.delete(captchaSessions)
				.where(eq(captchaSessions.pageThreadId, thread.id));
			await this.db
				.delete(pageFeedbackRecords)
				.where(eq(pageFeedbackRecords.pageThreadId, thread.id));
			await this.db
				.delete(pageViewSessions)
				.where(eq(pageViewSessions.pageThreadId, thread.id));
			await this.db
				.delete(comments)
				.where(eq(comments.pageThreadId, thread.id));
			await this.db.delete(pageThreads).where(eq(pageThreads.id, thread.id));
		}

		await this.db
			.update(siteSettings)
			.set(buildDefaultSiteSettings(site.id))
			.where(eq(siteSettings.siteId, site.id));

		return { ok: true };
	}

	public async inspect(
		siteKey: "default",
		pageKey: string,
		visitorKey: string | undefined,
		requestContext: {
			requestId?: string;
			ip?: string;
			userAgent?: string;
		},
	) {
		const state = await this.captchaService.getState({
			siteKey,
			pageKey,
			requestId: requestContext.requestId,
			visitorKey,
			ip: visitorKey ? undefined : requestContext.ip,
			userAgent: visitorKey ? undefined : requestContext.userAgent,
		});

		const site = this.commentsRepository.getRegisteredSite(siteKey);
		const [thread] = site
			? await this.db
					.select()
					.from(pageThreads)
					.where(
						and(
							eq(pageThreads.siteId, site.id),
							eq(pageThreads.pageKey, pageKey),
						),
					)
					.limit(1)
			: [];

		return {
			siteKey,
			pageKey,
			visitorKey,
			thread: thread
				? {
						commentCount: thread.commentCount,
						rootCommentCount: thread.rootCommentCount,
						pageLikeCount: thread.pageLikeCount,
					}
				: null,
			captcha: {
				required: state.required,
				verified: state.verified,
				mode: state.mode,
				challenge: state.challenge,
			},
		};
	}

	public async applyScenario(input: {
		siteKey: "default";
		pageKey: string;
		scenario:
			| "comments-captcha-always"
			| "comments-threshold-next-write"
			| "comments-seeded-thread";
		pageTitle?: string;
		pageUrl?: string;
	}) {
		const { site } = await this.ensureSite(input.siteKey);
		const thread = await this.commentsRepository.getOrCreatePageThread({
			siteId: site.id,
			pageKey: input.pageKey,
			pageTitle: input.pageTitle,
			pageUrl: input.pageUrl,
		});

		if (input.scenario === "comments-captcha-always") {
			await this.db
				.update(siteSettings)
				.set({
					...buildDefaultSiteSettings(site.id),
					captchaMode: "always",
				})
				.where(eq(siteSettings.siteId, site.id));
			await this.db
				.delete(captchaSessions)
				.where(eq(captchaSessions.pageThreadId, thread.id));

			return {
				ok: true,
				scenario: input.scenario,
			};
		}

		if (input.scenario === "comments-threshold-next-write") {
			await this.db
				.update(siteSettings)
				.set({
					...buildDefaultSiteSettings(site.id),
					captchaMode: "threshold",
					captchaThresholdWindowSec: 60,
					captchaThresholdMaxActions: 1,
				})
				.where(eq(siteSettings.siteId, site.id));
			await this.db
				.delete(captchaSessions)
				.where(eq(captchaSessions.pageThreadId, thread.id));

			return {
				ok: true,
				scenario: input.scenario,
			};
		}

		const visitorKey = `dev_visitor_${randomUUID()}`;
		await this.db.insert(visitors).values({
			siteId: site.id,
			visitorKey,
		});
		const [visitor] = await this.db
			.select()
			.from(visitors)
			.where(
				and(eq(visitors.siteId, site.id), eq(visitors.visitorKey, visitorKey)),
			)
			.limit(1);
		if (!visitor) {
			throw new Error("Expected seeded visitor");
		}

		const rootCommentId = `dev_comment_${randomUUID()}`;
		const replyCommentId = `dev_comment_${randomUUID()}`;

		await this.db.insert(comments).values([
			{
				id: rootCommentId,
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: null,
				visitorId: visitor.id,
				status: "approved",
				authorName: "Seed Root",
				authorEmail: "seed-root@example.com",
				contentRaw: "seeded root comment",
				replyCount: 1,
			},
			{
				id: replyCommentId,
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: rootCommentId,
				visitorId: visitor.id,
				status: "approved",
				authorName: "Seed Reply",
				authorEmail: "seed-reply@example.com",
				contentRaw: "seeded reply comment",
			},
		]);
		await this.db.insert(pageFeedbackRecords).values({
			pageThreadId: thread.id,
			visitorId: visitor.id,
		});
		await this.db
			.update(pageThreads)
			.set({
				commentCount: 2,
				rootCommentCount: 1,
				pageLikeCount: 1,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(pageThreads.id, thread.id));

		return {
			ok: true,
			scenario: input.scenario,
		};
	}
}
