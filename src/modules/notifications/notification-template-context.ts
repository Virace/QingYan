import { and, eq } from "drizzle-orm";

import { buildPublicUrl } from "../../config/public-path";
import type { AppConfig } from "../../config/types";
import type { DatabaseExecutor } from "../../db/client";
import {
	adminBootstrapState,
	commentModeration,
	commentRequestMetadata,
	comments,
	pageThreads,
	siteSettings,
	sites,
} from "../../db/schema";
import { mergeVerifiedAuthorSettings } from "../comments/verified-author";
import { normalizePagePath } from "../shared/page-url";
import type { NotificationDeliveryRecord, TaskRunRecord } from "../tasks/types";
import { CommenterPreferencesRepository } from "./commenter-preferences-repository";
import { UnsubscribeTokenService } from "./unsubscribe-token-service";
import { readCommentEventSnapshot } from "./comment-event-snapshot";

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

function trustedPageUrl(pageUrl: string | null, allowedOrigins: string[]) {
	const origin = allowedOrigins[0];
	if (!origin) return "";
	const url = new URL(origin);
	if (url.protocol !== "http:" && url.protocol !== "https:") return "";
	url.pathname = normalizePagePath(pageUrl) ?? "/";
	url.search = "";
	url.hash = "";
	return url.toString();
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
	return badgeLabel && badgeLabel !== authorName
		? `${authorName}（${badgeLabel}）`
		: authorName;
}

function clipContent(content: string, maxLength = 500) {
	const characters = Array.from(content);
	return characters.length > maxLength
		? `${characters.slice(0, maxLength).join("")}…`
		: content;
}

function contentForRecipient(content: string, payload: unknown) {
	const level =
		payload && typeof payload === "object" && "includeCommentContent" in payload
			? payload.includeCommentContent
			: "summary";
	if (level === "none")
		return { content: "", contentNote: "本邮件不包含正文，请进入后台查看。" };
	if (level === "full") return { content, contentNote: "完整正文" };
	const summary = clipContent(content);
	return {
		content: summary,
		contentNote:
			summary === content
				? "正文摘要"
				: "正文摘要已截断，请进入后台查看完整内容。",
	};
}

function eventTime(iso: string) {
	return {
		iso,
		display: `${iso
			.replace("T", " ")
			.replace(/\.\d+Z$/u, "")
			.replace(/Z$/u, "")} UTC`,
	};
}

function reviewReason(reason: string | null | undefined, status: string) {
	if (reason === "local_history_insufficient")
		return "正常评论历史依据不足，等待人工审核。";
	if (reason === "manual_review" || reason === "akismet_ham_manual_review")
		return "本站采用人工审核，等待站点人员处理。";
	if (
		reason === "akismet_error" ||
		reason === "akismet_unavailable" ||
		reason === "akismet_api_key_missing"
	)
		return "反垃圾检查暂不可用，等待人工审核。";
	return status === "approved"
		? "评论已按站点审核策略发布。"
		: "等待站点人员审核。";
}

export class NotificationTemplateContextBuilder {
	public constructor(
		private readonly db: DatabaseExecutor,
		private readonly config: Pick<
			AppConfig["server"],
			"publicBaseUrl" | "publicPath"
		>,
		private readonly consolePath?: string,
	) {}

	public async buildTransient(
		input: NotificationTemplateContextBuilderInput,
	): Promise<Record<string, unknown>> {
		if (input.delivery.recipientType !== "commenter" || !input.task.siteId)
			return {};
		const issued = await new UnsubscribeTokenService(
			this.db,
			new CommenterPreferencesRepository(this.db),
		).issue({
			siteId: input.task.siteId,
			email: input.delivery.recipientAddressSnapshot,
			purpose: "commenter_reply",
		});
		return {
			unsubscribe: `${buildPublicUrl(this.config.publicBaseUrl, this.config.publicPath, "/notifications/unsubscribe")}?token=${encodeURIComponent(issued.token)}`,
		};
	}

	public async build(input: NotificationTemplateContextBuilderInput) {
		if (
			(input.delivery.recipientType === "backend_user" ||
				input.delivery.recipientType === "external_target") &&
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
		const snapshot = readCommentEventSnapshot(input.task.payload);
		const replyCommentId =
			typeof payload.replyCommentId === "string"
				? payload.replyCommentId
				: input.task.subjectId;
		if (!replyCommentId) {
			return {};
		}

		const [reply] = snapshot
			? [snapshot.comment]
			: await this.db
					.select()
					.from(comments)
					.where(
						and(
							eq(comments.id, replyCommentId),
							eq(comments.siteId, input.task.siteId),
						),
					)
					.limit(1);
		if (!reply) {
			return {};
		}

		const parentCommentId =
			typeof payload.parentCommentId === "string"
				? payload.parentCommentId
				: reply.parentId;
		const [parent] = snapshot
			? [snapshot.parent]
			: parentCommentId
				? await this.db
						.select()
						.from(comments)
						.where(eq(comments.id, parentCommentId))
						.limit(1)
				: [];
		const [thread] = snapshot
			? [snapshot.thread]
			: await this.db
					.select()
					.from(pageThreads)
					.where(eq(pageThreads.id, reply.pageThreadId))
					.limit(1);
		const [site] = snapshot
			? [snapshot.site]
			: await this.db
					.select()
					.from(sites)
					.where(eq(sites.id, input.task.siteId))
					.limit(1);
		const [settings] = snapshot
			? [snapshot.settings]
			: await this.db
					.select({
						verifiedAuthorJson: siteSettings.verifiedAuthorJson,
					})
					.from(siteSettings)
					.where(eq(siteSettings.siteId, input.task.siteId))
					.limit(1);
		if (!parent || !thread || !site || reply.siteId !== input.task.siteId) {
			return {};
		}
		const replyAuthorName = fallbackText(reply.authorName, "评论者");
		const replyBadgeLabel = badgeLabelForReply({
			authorIdentity: reply.authorIdentity,
			verifiedAuthorJson: settings?.verifiedAuthorJson,
		});

		const transient = await this.buildTransient(input);

		return {
			site: {
				name: site.name,
				key: site.siteKey,
			},
			page: {
				title: fallbackText(
					thread.pageTitle,
					normalizePagePath(thread.pageUrl) ?? thread.pageKey,
				),
				key: thread.pageKey,
				url: trustedPageUrl(
					thread.pageUrl,
					parseAllowedOrigins(site.allowedOriginsJson),
				),
			},
			parent: {
				authorName: fallbackText(parent.authorName, "评论者"),
				content: parent.deletedAt
					? "原评论已删除"
					: clipContent(parent.contentRaw),
			},
			comment: {
				authorName: replyAuthorName,
				authorLabel: authorLabel(replyAuthorName, replyBadgeLabel),
				badgeLabel: replyBadgeLabel,
				content: reply.contentRaw,
				contentNote: "完整回复正文",
			},
			links: {
				...transient,
			},
			time: eventTime(reply.createdAt),
		};
	}

	private async buildBackendCommentContext(
		input: NotificationTemplateContextBuilderInput,
	) {
		const commentId = input.task.subjectId;
		if (!commentId || !input.task.siteId) {
			return {};
		}
		const snapshot = readCommentEventSnapshot(input.task.payload);
		const [comment] = snapshot
			? [snapshot.comment]
			: await this.db
					.select()
					.from(comments)
					.where(
						and(
							eq(comments.id, commentId),
							eq(comments.siteId, input.task.siteId),
						),
					)
					.limit(1);
		if (!comment) {
			return {};
		}
		const [thread] = snapshot
			? [snapshot.thread]
			: await this.db
					.select()
					.from(pageThreads)
					.where(eq(pageThreads.id, comment.pageThreadId))
					.limit(1);
		const [site] = snapshot
			? [snapshot.site]
			: await this.db
					.select()
					.from(sites)
					.where(eq(sites.id, input.task.siteId))
					.limit(1);
		const [settings] = snapshot
			? [snapshot.settings]
			: await this.db
					.select({
						verifiedAuthorJson: siteSettings.verifiedAuthorJson,
						commentMetadataJson: siteSettings.commentMetadataJson,
					})
					.from(siteSettings)
					.where(eq(siteSettings.siteId, input.task.siteId))
					.limit(1);
		if (!thread || !site || comment.siteId !== input.task.siteId) {
			return {};
		}
		const commentAuthorName = fallbackText(comment.authorName, "评论者");
		const badgeLabel = badgeLabelForReply({
			authorIdentity: comment.authorIdentity,
			verifiedAuthorJson: settings?.verifiedAuthorJson,
		});
		const [bootstrap] = await this.db
			.select({ consolePath: adminBootstrapState.consolePath })
			.from(adminBootstrapState)
			.limit(1);
		const [metadata] = snapshot
			? [snapshot.metadata]
			: await this.db
					.select()
					.from(commentRequestMetadata)
					.where(eq(commentRequestMetadata.commentId, comment.id))
					.limit(1);
		const [moderation] = snapshot
			? [snapshot.moderation]
			: await this.db
					.select()
					.from(commentModeration)
					.where(eq(commentModeration.commentId, comment.id))
					.limit(1);
		const [parent] = snapshot
			? [snapshot.parent]
			: comment.parentId
				? await this.db
						.select()
						.from(comments)
						.where(
							and(
								eq(comments.id, comment.parentId),
								eq(comments.siteId, site.id),
							),
						)
						.limit(1)
				: [];
		let collection: { collectIp?: boolean; collectUserAgent?: boolean } = {};
		if (settings?.commentMetadataJson)
			collection = JSON.parse(settings.commentMetadataJson);
		const payload =
			input.task.payload && typeof input.task.payload === "object"
				? (input.task.payload as Record<string, unknown>)
				: {};
		const rawContent =
			typeof payload.contentRaw === "string"
				? payload.contentRaw
				: comment.contentRaw;
		const status =
			input.delivery.templateKey === "backend_user.comment.approved"
				? "approved"
				: "pending";
		const adminCommentUrl = new URL(
			buildPublicUrl(
				this.config.publicBaseUrl,
				this.config.publicPath,
				this.consolePath ?? bootstrap?.consolePath ?? "/admin",
			),
		);
		adminCommentUrl.searchParams.set("commentId", comment.id);
		adminCommentUrl.searchParams.set("siteKey", site.siteKey);
		adminCommentUrl.searchParams.set("view", "comments");

		return {
			site: {
				name: site.name,
				key: site.siteKey,
			},
			page: {
				title: fallbackText(
					thread.pageTitle,
					normalizePagePath(thread.pageUrl) ?? thread.pageKey,
				),
				key: thread.pageKey,
				url: trustedPageUrl(
					thread.pageUrl,
					parseAllowedOrigins(site.allowedOriginsJson),
				),
			},
			comment: {
				authorName: commentAuthorName,
				authorLabel: authorLabel(commentAuthorName, badgeLabel),
				badgeLabel,
				...contentForRecipient(rawContent, input.task.payload),
				authorEmail: comment.authorEmail ?? "未提供",
				authorWebsite: comment.authorWebsite ?? "未提供",
				authorIdentity: comment.authorUserId ? "已登录后台账号" : "访客",
				status: status === "approved" ? "已发布" : "待审核",
			},
			parent: {
				authorName:
					parent && !parent.deletedAt
						? fallbackText(parent.authorName, "评论者")
						: "无",
				content:
					parent && !parent.deletedAt
						? clipContent(
								contentForRecipient(parent.contentRaw, input.task.payload)
									.content,
							)
						: "无可用的回复上下文",
			},
			moderation: {
				verdict:
					moderation?.akismetVerdict === "ham"
						? "未识别为垃圾"
						: moderation?.akismetVerdict === "spam"
							? "垃圾评论"
							: "未取得外部判定",
				reason: reviewReason(moderation?.reason, status),
			},
			request: {
				ip:
					collection.collectIp === false
						? "未收集"
						: (metadata?.authorIp ?? "未收集"),
				userAgent:
					collection.collectUserAgent === false
						? "未收集"
						: (metadata?.authorUserAgent ?? "未收集"),
				device:
					collection.collectUserAgent === false
						? "未收集"
						: [metadata?.deviceBrowser, metadata?.deviceOs]
								.filter(Boolean)
								.join(" / ") || "未识别",
			},
			links: {
				adminComment: adminCommentUrl.toString(),
			},
			time: eventTime(comment.createdAt),
		};
	}
}
