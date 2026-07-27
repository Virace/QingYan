import { eq } from "drizzle-orm";

import { buildPublicUrl } from "../../config/public-path";
import type { AppConfig } from "../../config/types";
import type { AppDatabase } from "../../db/client";
import { comments, pageThreads, siteSettings, sites } from "../../db/schema";
import { mergeVerifiedAuthorSettings } from "../comments/verified-author";
import { resolvePublicPageUrl } from "../shared/page-url";
import type { NotificationDeliveryRecord, TaskRunRecord } from "../tasks/types";
import { CommenterPreferencesRepository } from "./commenter-preferences-repository";
import { UnsubscribeTokenService } from "./unsubscribe-token-service";

export interface NotificationTemplateContextBuilderInput {
	task: TaskRunRecord;
	delivery: NotificationDeliveryRecord;
}

type ReplyApprovedPayload = {
	event?: unknown;
	parentCommentId?: unknown;
	replyCommentId?: unknown;
};

function asReplyApprovedPayload(payload: unknown): ReplyApprovedPayload {
	return payload && typeof payload === "object"
		? (payload as ReplyApprovedPayload)
		: {};
}

function fallbackText(value: string | null | undefined, fallback: string) {
	const normalized = value?.trim();
	return normalized ? normalized : fallback;
}

function parseAllowedOrigins(value: string): string[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

function badgeLabelForReply(input: {
	authorIdentity: string;
	verifiedAuthorJson: string | null | undefined;
}): string {
	if (input.authorIdentity !== "verified" && input.authorIdentity !== "staff") {
		return "";
	}
	return mergeVerifiedAuthorSettings(input.verifiedAuthorJson).badgeLabel;
}

function authorLabel(authorName: string, badgeLabel: string): string {
	return badgeLabel ? `${authorName}（${badgeLabel}）` : authorName;
}

export class NotificationTemplateContextBuilder {
	public constructor(
		private readonly db: AppDatabase,
		private readonly config: Pick<
			AppConfig["server"],
			"publicBaseUrl" | "publicPath"
		>,
	) {}

	public async build(input: NotificationTemplateContextBuilderInput) {
		if (
			input.delivery.recipientType === "backend_user" &&
			(input.delivery.templateKey === "backend_user.comment.pending" ||
				input.delivery.templateKey === "backend_user.comment.approved")
		) {
			return this.buildBackendCommentContext(input);
		}
		if (
			input.delivery.templateKey !== "commenter.reply_approved" &&
			asReplyApprovedPayload(input.task.payload).event !== "reply_approved"
		) {
			return {};
		}
		if (input.delivery.recipientType !== "commenter" || !input.task.siteId) {
			return {};
		}

		const payload = asReplyApprovedPayload(input.task.payload);
		const replyCommentId =
			typeof payload.replyCommentId === "string"
				? payload.replyCommentId
				: input.task.subjectId;
		if (!replyCommentId) {
			return {};
		}

		const [reply] = await this.db
			.select()
			.from(comments)
			.where(eq(comments.id, replyCommentId))
			.limit(1);
		if (!reply) {
			return {};
		}

		const parentCommentId =
			typeof payload.parentCommentId === "string"
				? payload.parentCommentId
				: reply.parentId;
		const [parent] = parentCommentId
			? await this.db
					.select()
					.from(comments)
					.where(eq(comments.id, parentCommentId))
					.limit(1)
			: [];
		const [thread] = await this.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.id, reply.pageThreadId))
			.limit(1);
		const [site] = await this.db
			.select()
			.from(sites)
			.where(eq(sites.id, input.task.siteId))
			.limit(1);
		const [settings] = await this.db
			.select({
				verifiedAuthorJson: siteSettings.verifiedAuthorJson,
			})
			.from(siteSettings)
			.where(eq(siteSettings.siteId, input.task.siteId))
			.limit(1);
		if (!parent || !thread || !site) {
			return {};
		}
		const replyAuthorName = fallbackText(reply.authorName, "评论者");
		const replyBadgeLabel = badgeLabelForReply({
			authorIdentity: reply.authorIdentity,
			verifiedAuthorJson: settings?.verifiedAuthorJson,
		});

		const issued = await new UnsubscribeTokenService(
			this.db,
			new CommenterPreferencesRepository(this.db),
		).issue({
			siteId: input.task.siteId,
			email: input.delivery.recipientAddressSnapshot,
			purpose: "commenter_reply",
		});

		return {
			site: {
				name: site.name,
				key: site.siteKey,
			},
			page: {
				title: fallbackText(thread.pageTitle, thread.pageKey),
				key: thread.pageKey,
				url:
					resolvePublicPageUrl(
						thread.pageUrl,
						parseAllowedOrigins(site.allowedOriginsJson),
					) ??
					thread.pageUrl ??
					thread.pageKey,
			},
			parent: {
				authorName: fallbackText(parent.authorName, "评论者"),
				content: parent.contentRaw,
			},
			comment: {
				authorName: replyAuthorName,
				authorLabel: authorLabel(replyAuthorName, replyBadgeLabel),
				badgeLabel: replyBadgeLabel,
				content: reply.contentRaw,
			},
			links: {
				unsubscribe: `${buildPublicUrl(
					this.config.publicBaseUrl,
					this.config.publicPath,
					"/notifications/unsubscribe",
				)}?token=${encodeURIComponent(issued.token)}`,
			},
			time: {
				iso: new Date().toISOString(),
			},
		};
	}

	private async buildBackendCommentContext(
		input: NotificationTemplateContextBuilderInput,
	) {
		const commentId = input.task.subjectId;
		if (!commentId || !input.task.siteId) {
			return {};
		}
		const [comment] = await this.db
			.select()
			.from(comments)
			.where(eq(comments.id, commentId))
			.limit(1);
		if (!comment) {
			return {};
		}
		const [thread] = await this.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.id, comment.pageThreadId))
			.limit(1);
		const [site] = await this.db
			.select()
			.from(sites)
			.where(eq(sites.id, input.task.siteId))
			.limit(1);
		const [settings] = await this.db
			.select({
				verifiedAuthorJson: siteSettings.verifiedAuthorJson,
			})
			.from(siteSettings)
			.where(eq(siteSettings.siteId, input.task.siteId))
			.limit(1);
		if (!thread || !site) {
			return {};
		}
		const commentAuthorName = fallbackText(comment.authorName, "评论者");
		const badgeLabel = badgeLabelForReply({
			authorIdentity: comment.authorIdentity,
			verifiedAuthorJson: settings?.verifiedAuthorJson,
		});
		const adminCommentUrl = new URL(
			buildPublicUrl(
				this.config.publicBaseUrl,
				this.config.publicPath,
				"/admin",
			),
		);
		adminCommentUrl.searchParams.set("commentId", comment.id);

		return {
			site: {
				name: site.name,
				key: site.siteKey,
			},
			page: {
				title: fallbackText(thread.pageTitle, thread.pageKey),
				key: thread.pageKey,
				url:
					resolvePublicPageUrl(
						thread.pageUrl,
						parseAllowedOrigins(site.allowedOriginsJson),
					) ??
					thread.pageUrl ??
					thread.pageKey,
			},
			comment: {
				authorName: commentAuthorName,
				authorLabel: authorLabel(commentAuthorName, badgeLabel),
				badgeLabel,
				content: comment.contentRaw,
			},
			links: {
				adminComment: adminCommentUrl.toString(),
			},
			time: {
				iso: new Date().toISOString(),
			},
		};
	}
}
