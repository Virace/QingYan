import { randomInt, randomUUID } from "node:crypto";

import type { SiteConfig } from "../../config/types";
import { AppError, ResourceNotFoundError } from "../shared/errors";
import { buildCommentForm } from "../comments/comment-form";
import { presentComments } from "../comments/presenter";

type ScenarioName =
	| "comments-captcha-always"
	| "comments-threshold-next-write"
	| "comments-seeded-thread";

type VoteChoice = "up" | "down";
type CaptchaRequiredCode = "COMMENT_CAPTCHA_REQUIRED" | "VOTE_CAPTCHA_REQUIRED";

type RuntimeCommentRecord = {
	id: string;
	parentId: string | null;
	authorName: string;
	authorWebsite: string | null;
	contentRaw: string;
	contentHtml: string | null;
	status: "pending" | "approved";
	isPinned: boolean;
	isFolded: boolean;
	replyCount: number;
	voteUpCount: number;
	voteDownCount: number;
	createdAt: string;
	updatedAt: string | null;
};

type RuntimeVisitorState = {
	visitorKey: string;
	verified: boolean;
	challengeId: string | null;
	challengeAnswer: string | null;
	challengeImageData: string | null;
	captchaFailures: number;
	blacklisted: boolean;
	votes: Map<string, VoteChoice>;
	likedPage: boolean;
	thresholdTriggered: boolean;
};

type RuntimePageState = {
	pageKey: string;
	pageTitle: string;
	pageUrl: string;
	scenario: ScenarioName | null;
	pageViewCount: number;
	baseLikeCount: number;
	commentOrder: string[];
	comments: Map<string, RuntimeCommentRecord>;
	visitorStates: Map<string, RuntimeVisitorState>;
};

type RuntimeCaptchaState = {
	required: boolean;
	verified: boolean;
	mode: "inline_value";
	challenge: {
		challengeId: string;
		mode: "inline_value";
		imageData: string;
	} | null;
};

function nowIso(): string {
	return new Date().toISOString();
}

function buildSvgCaptcha(answer: string): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60" viewBox="0 0 160 60"><rect width="160" height="60" rx="8" fill="#f6f1e7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="28" font-family="monospace" fill="#1f2937">${answer}</text></svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function createChallengeAnswer(): string {
	return `${randomInt(1000, 9999)}`;
}

function createVisitorKey(): string {
	return `dev_visitor_${randomUUID()}`;
}

function toPublicTimestamp(value: string | null): string | null {
	if (!value) {
		return null;
	}

	const timestamp = new Date(value);
	return Number.isNaN(timestamp.getTime()) ? value : timestamp.toISOString();
}

function normalizePageUrl(value?: string): string {
	if (!value) {
		return "https://example.test/";
	}

	return value;
}

function cloneSiteForDefault(baseSite: SiteConfig): SiteConfig {
	return {
		...baseSite,
		siteKey: "default",
		name: "Default",
	};
}

function sortComments(
	comments: RuntimeCommentRecord[],
	sortBy: "newest" | "oldest",
): RuntimeCommentRecord[] {
	return [...comments].sort((left, right) => {
		if (sortBy === "oldest") {
			return left.createdAt.localeCompare(right.createdAt);
		}

		return right.createdAt.localeCompare(left.createdAt);
	});
}

export class DevMockService {
	private readonly configuredSite: SiteConfig;

	private readonly pages = new Map<string, RuntimePageState>();

	public constructor(baseSite: SiteConfig) {
		this.configuredSite = cloneSiteForDefault(baseSite);
	}

	public ownsSite(siteKey: string): boolean {
		return siteKey === "default";
	}

	public getConfiguredSite(siteKey: string): SiteConfig | undefined {
		return this.ownsSite(siteKey) ? this.configuredSite : undefined;
	}

	private ensurePageState(input: {
		pageKey: string;
		pageTitle?: string;
		pageUrl?: string;
	}) {
		const existing = this.pages.get(input.pageKey);
		if (existing) {
			existing.pageTitle = input.pageTitle || existing.pageTitle;
			existing.pageUrl = normalizePageUrl(input.pageUrl || existing.pageUrl);
			return existing;
		}

		const created: RuntimePageState = {
			pageKey: input.pageKey,
			pageTitle: input.pageTitle || input.pageKey,
			pageUrl: normalizePageUrl(input.pageUrl),
			scenario: null,
			pageViewCount: 0,
			baseLikeCount: 0,
			commentOrder: [],
			comments: new Map(),
			visitorStates: new Map(),
		};
		this.pages.set(input.pageKey, created);
		return created;
	}

	private ensureVisitorState(
		pageState: RuntimePageState,
		visitorKey?: string,
	): { visitorKey: string; visitor: RuntimeVisitorState; created: boolean } {
		const resolvedVisitorKey = visitorKey || createVisitorKey();
		const existing = pageState.visitorStates.get(resolvedVisitorKey);
		if (existing) {
			return {
				visitorKey: resolvedVisitorKey,
				visitor: existing,
				created: false,
			};
		}

		const created: RuntimeVisitorState = {
			visitorKey: resolvedVisitorKey,
			verified: false,
			challengeId: null,
			challengeAnswer: null,
			challengeImageData: null,
			captchaFailures: 0,
			blacklisted: false,
			votes: new Map(),
			likedPage: false,
			thresholdTriggered: false,
		};
		pageState.visitorStates.set(resolvedVisitorKey, created);
		return {
			visitorKey: resolvedVisitorKey,
			visitor: created,
			created: true,
		};
	}

	private clearCaptcha(visitor: RuntimeVisitorState) {
		visitor.challengeId = null;
		visitor.challengeAnswer = null;
		visitor.challengeImageData = null;
	}

	private ensureCaptcha(visitor: RuntimeVisitorState): RuntimeCaptchaState {
		if (!visitor.challengeId || !visitor.challengeImageData || !visitor.challengeAnswer) {
			const answer = createChallengeAnswer();
			visitor.challengeId = `cap_${randomUUID()}`;
			visitor.challengeAnswer = answer;
			visitor.challengeImageData = buildSvgCaptcha(answer);
		}

		return {
			required: true,
			verified: false,
			mode: "inline_value",
			challenge: {
				challengeId: visitor.challengeId,
				mode: "inline_value",
				imageData: visitor.challengeImageData,
			},
		};
	}

	private getCaptchaStateForVisitor(
		pageState: RuntimePageState,
		visitor: RuntimeVisitorState,
	): RuntimeCaptchaState {
		if (visitor.blacklisted) {
			return {
				required: false,
				verified: false,
				mode: "inline_value",
				challenge: null,
			};
		}

		if (pageState.scenario === "comments-captcha-always") {
			if (visitor.verified) {
				return {
					required: true,
					verified: true,
					mode: "inline_value",
					challenge: null,
				};
			}

			return this.ensureCaptcha(visitor);
		}

		if (
			pageState.scenario === "comments-threshold-next-write" &&
			(visitor.thresholdTriggered || visitor.challengeId)
		) {
			if (visitor.verified) {
				return {
					required: true,
					verified: true,
					mode: "inline_value",
					challenge: null,
				};
			}

			return this.ensureCaptcha(visitor);
		}

		return {
			required: false,
			verified: false,
			mode: "inline_value",
			challenge: null,
		};
	}

	private buildViewerVoteMap(visitor: RuntimeVisitorState) {
		return new Map(visitor.votes);
	}

	private getRootComments(pageState: RuntimePageState) {
		return pageState.commentOrder
			.map((commentId) => pageState.comments.get(commentId))
			.filter(
				(comment): comment is RuntimeCommentRecord =>
					Boolean(comment && comment.parentId === null),
			);
	}

	private buildThreadBody(input: {
		pageState: RuntimePageState;
		visitor: RuntimeVisitorState;
		sortBy: "newest" | "oldest";
		limit: number;
		offset: number;
	}) {
		const rootComments = sortComments(
			this.getRootComments(input.pageState),
			input.sortBy,
		);
		const paginatedRootComments = rootComments.slice(
			input.offset,
			input.offset + input.limit,
		);
		const includedCommentIds = new Set(
			paginatedRootComments.map((comment) => comment.id),
		);
		let changed = true;
		while (changed) {
			changed = false;
			for (const comment of input.pageState.comments.values()) {
				if (
					comment.parentId &&
					includedCommentIds.has(comment.parentId) &&
					!includedCommentIds.has(comment.id)
				) {
					includedCommentIds.add(comment.id);
					changed = true;
				}
			}
		}

		const selectedComments = input.pageState.commentOrder
			.map((commentId) => input.pageState.comments.get(commentId))
			.filter(
				(comment): comment is RuntimeCommentRecord =>
					Boolean(comment && includedCommentIds.has(comment.id)),
			);

		return {
			thread: {
				siteKey: "default",
				pageKey: input.pageState.pageKey,
				pageTitle: input.pageState.pageTitle,
			},
			pagination: {
				sortBy: input.sortBy,
				limit: input.limit,
				offset: input.offset,
				totalCount: input.pageState.comments.size,
				rootCount: rootComments.length,
			},
			comments: presentComments(
				selectedComments.map((comment) => ({
					...comment,
					updatedAt: comment.updatedAt ?? comment.createdAt,
				})),
				this.buildViewerVoteMap(input.visitor),
			),
		};
	}

	private buildCapability() {
		return {
			enabled: this.configuredSite.defaults.comments.enabled,
			supportsReply: this.configuredSite.defaults.comments.maxDepth > 1,
			supportsVote: true,
			supportsCaptcha: this.configuredSite.defaults.comments.captcha.mode !== "never",
			defaultStatus: this.configuredSite.defaults.comments.defaultStatus,
			message: null,
		};
	}

	private createSeededThread(pageState: RuntimePageState) {
		pageState.comments.clear();
		pageState.commentOrder = [];
		pageState.pageViewCount = 0;
		pageState.baseLikeCount = 1;

		const rootId = `dev_comment_${randomUUID()}`;
		const replyId = `dev_comment_${randomUUID()}`;
		const createdAt = nowIso();
		pageState.comments.set(rootId, {
			id: rootId,
			parentId: null,
			authorName: "Seed Root",
			authorWebsite: null,
			contentRaw: "seeded root comment",
			contentHtml: null,
			status: "approved",
			isPinned: false,
			isFolded: false,
			replyCount: 1,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt,
			updatedAt: null,
		});
		pageState.comments.set(replyId, {
			id: replyId,
			parentId: rootId,
			authorName: "Seed Reply",
			authorWebsite: null,
			contentRaw: "seeded reply comment",
			contentHtml: null,
			status: "approved",
			isPinned: false,
			isFolded: false,
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt,
			updatedAt: null,
		});
		pageState.commentOrder = [rootId, replyId];
	}

	public async applyScenario(input: {
		siteKey: string;
		pageKey: string;
		scenario: ScenarioName;
		pageTitle?: string;
		pageUrl?: string;
	}) {
		if (!this.ownsSite(input.siteKey)) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const pageState = this.ensurePageState(input);
		pageState.scenario = input.scenario;
		pageState.pageTitle = input.pageTitle || pageState.pageTitle;
		pageState.pageUrl = normalizePageUrl(input.pageUrl || pageState.pageUrl);
		pageState.visitorStates.clear();

		if (input.scenario === "comments-seeded-thread") {
			this.createSeededThread(pageState);
		} else {
			pageState.comments.clear();
			pageState.commentOrder = [];
			pageState.pageViewCount = 0;
			pageState.baseLikeCount = 0;
		}

		return {
			ok: true,
			scenario: input.scenario,
		};
	}

	public async resetPageState(siteKey: "default", pageKey: string) {
		if (!this.ownsSite(siteKey)) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		this.pages.delete(pageKey);
		return {
			ok: true,
		};
	}

	public async inspect(
		siteKey: string,
		pageKey: string,
		visitorKey?: string,
	) {
		if (!this.ownsSite(siteKey)) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const pageState = this.pages.get(pageKey);
		const visitor = visitorKey
			? pageState?.visitorStates.get(visitorKey) ?? null
			: null;
		const captcha = pageState && visitor
			? this.getCaptchaStateForVisitor(pageState, visitor)
			: {
					required: false,
					verified: false,
					mode: "inline_value" as const,
					challenge: null,
				};

		return {
			siteKey,
			pageKey,
			visitorKey,
			thread: pageState
				? {
						commentCount: pageState.comments.size,
						rootCommentCount: this.getRootComments(pageState).length,
						pageLikeCount:
							pageState.baseLikeCount +
							[...pageState.visitorStates.values()].filter((state) => state.likedPage)
								.length,
					}
				: null,
			captcha,
		};
	}

	private setVisitorCookieResult<T>(body: T, created: boolean, visitorKey: string) {
		return {
			body,
			visitorKey: created ? visitorKey : undefined,
		};
	}

	public async getBootstrap(input: {
		siteKey: string;
		pageKey: string;
		pageTitle?: string;
		pageUrl?: string;
		sortBy: "newest" | "oldest";
		limit: number;
		offset: number;
		visitorKey?: string;
	}) {
		const pageState = this.ensurePageState(input);
		pageState.pageViewCount += 1;
		const visitorResult = this.ensureVisitorState(pageState, input.visitorKey);
		const captcha = this.getCaptchaStateForVisitor(pageState, visitorResult.visitor);
		const threadBody = this.buildThreadBody({
			pageState,
			visitor: visitorResult.visitor,
			sortBy: input.sortBy,
			limit: input.limit,
			offset: input.offset,
		});

		return this.setVisitorCookieResult(
			{
				capability: this.buildCapability(),
				commentForm: buildCommentForm(this.configuredSite, {
					allowWebsite: this.configuredSite.defaults.comments.allowWebsite,
				}),
				...threadBody,
				pageMetrics: {
					pageViewCount: pageState.pageViewCount,
				},
				pageFeedback: {
					supportsLike: this.configuredSite.defaults.pageFeedback.allowLike,
					likeCount:
						pageState.baseLikeCount +
						[...pageState.visitorStates.values()].filter((state) => state.likedPage)
							.length,
					liked: visitorResult.visitor.likedPage,
				},
				captcha,
			},
			visitorResult.created,
			visitorResult.visitorKey,
		);
	}

	public async getThread(input: {
		siteKey: string;
		pageKey: string;
		pageTitle?: string;
		pageUrl?: string;
		sortBy: "newest" | "oldest";
		limit: number;
		offset: number;
		visitorKey?: string;
	}) {
		const pageState = this.ensurePageState(input);
		const visitorResult = this.ensureVisitorState(pageState, input.visitorKey);
		return this.setVisitorCookieResult(
			this.buildThreadBody({
				pageState,
				visitor: visitorResult.visitor,
				sortBy: input.sortBy,
				limit: input.limit,
				offset: input.offset,
			}),
			visitorResult.created,
			visitorResult.visitorKey,
		);
	}

	public async getCaptchaState(input: {
		siteKey: string;
		pageKey: string;
		pageTitle?: string;
		pageUrl?: string;
		visitorKey?: string;
	}) {
		const pageState = this.ensurePageState(input);
		const visitorResult = this.ensureVisitorState(pageState, input.visitorKey);
		return this.setVisitorCookieResult(
			this.getCaptchaStateForVisitor(pageState, visitorResult.visitor),
			visitorResult.created,
			visitorResult.visitorKey,
		);
	}

	public async verifyCaptcha(input: {
		siteKey: string;
		pageKey: string;
		challengeId: string;
		value: string;
		visitorKey?: string;
	}) {
		const pageState = this.ensurePageState(input);
		const visitorResult = this.ensureVisitorState(pageState, input.visitorKey);
		const visitor = visitorResult.visitor;
		if (visitor.blacklisted) {
			throw new AppError(403, "COMMENT_BLACKLISTED", "当前请求已被拒绝。");
		}
		if (!visitor.challengeId || visitor.challengeId !== input.challengeId) {
			throw new AppError(
				400,
				"COMMENT_CAPTCHA_REQUIRED",
				"请先完成验证码验证。",
			);
		}
		if (visitor.challengeAnswer !== input.value.trim()) {
			visitor.captchaFailures += 1;
			if (visitor.captchaFailures >= 2) {
				visitor.blacklisted = true;
				this.clearCaptcha(visitor);
				throw new AppError(403, "COMMENT_BLACKLISTED", "当前请求已被拒绝。");
			}
			throw new AppError(400, "COMMENT_CAPTCHA_INVALID", "验证码错误。");
		}

		visitor.verified = true;
		visitor.captchaFailures = 0;
		this.clearCaptcha(visitor);
		return this.setVisitorCookieResult(
			{
				required: true,
				verified: true,
			},
			visitorResult.created,
			visitorResult.visitorKey,
		);
	}

	private ensureWriteAllowed(
		pageState: RuntimePageState,
		visitor: RuntimeVisitorState,
		errorCode: CaptchaRequiredCode,
	) {
		if (visitor.blacklisted) {
			throw new AppError(403, "COMMENT_BLACKLISTED", "当前请求已被拒绝。");
		}

		if (pageState.scenario === "comments-captcha-always" && !visitor.verified) {
			this.ensureCaptcha(visitor);
			throw new AppError(400, errorCode, "请先完成验证码验证。");
		}

		if (
			pageState.scenario === "comments-threshold-next-write" &&
			(!visitor.verified || visitor.challengeId)
		) {
			visitor.thresholdTriggered = true;
			this.ensureCaptcha(visitor);
			throw new AppError(400, errorCode, "请先完成验证码验证。");
		}
	}

	private addComment(
		pageState: RuntimePageState,
		input: {
			parentCommentId: string | null;
			authorName: string;
			authorWebsite?: string;
			contentRaw: string;
		},
	) {
		const createdAt = nowIso();
		const commentId = `dev_comment_${randomUUID()}`;
		pageState.comments.set(commentId, {
			id: commentId,
			parentId: input.parentCommentId,
			authorName: input.authorName,
			authorWebsite: input.authorWebsite ?? null,
			contentRaw: input.contentRaw,
			contentHtml: null,
			status: this.configuredSite.defaults.comments.defaultStatus,
			isPinned: false,
			isFolded: false,
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt,
			updatedAt: null,
		});
		pageState.commentOrder.push(commentId);

		if (input.parentCommentId) {
			const parent = pageState.comments.get(input.parentCommentId);
			if (!parent) {
				throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
			}
			parent.replyCount += 1;
			parent.updatedAt = createdAt;
		}

		return {
			commentId,
			status: this.configuredSite.defaults.comments.defaultStatus,
		};
	}

	public async createComment(input: {
		siteKey: string;
		pageKey: string;
		pageTitle: string;
		pageUrl: string;
		parentCommentId: string | null;
		author: {
			name?: string;
			email?: string;
			website?: string;
		};
		contentRaw: string;
		visitorKey?: string;
	}) {
		const pageState = this.ensurePageState(input);
		const visitorResult = this.ensureVisitorState(pageState, input.visitorKey);
		const visitor = visitorResult.visitor;
		this.ensureWriteAllowed(pageState, visitor, "COMMENT_CAPTCHA_REQUIRED");

		const created = this.addComment(pageState, {
			parentCommentId: input.parentCommentId,
			authorName: input.author.name?.trim() || "Anonymous",
			authorWebsite: input.author.website?.trim() || undefined,
			contentRaw: input.contentRaw,
		});

		return this.setVisitorCookieResult(
			{
				comment: {
					id: created.commentId,
					status: created.status,
					message:
						created.status === "pending"
							? "评论已提交，等待审核。"
							: "评论已发布。",
				},
				thread: {
					commentCount: pageState.comments.size,
					rootCommentCount: this.getRootComments(pageState).length,
				},
			},
			visitorResult.created,
			visitorResult.visitorKey,
		);
	}

	public async castVote(input: {
		siteKey: string;
		pageKey: string;
		commentId: string;
		choice: VoteChoice;
		visitorKey?: string;
	}) {
		const pageState = this.ensurePageState(input);
		const visitorResult = this.ensureVisitorState(pageState, input.visitorKey);
		const visitor = visitorResult.visitor;
		this.ensureWriteAllowed(pageState, visitor, "VOTE_CAPTCHA_REQUIRED");

		const comment = pageState.comments.get(input.commentId);
		if (!comment) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}
		if (visitor.votes.has(input.commentId)) {
			throw new AppError(
				409,
				"VOTE_ALREADY_CAST",
				"你已经投过票，当前不允许再次修改。",
			);
		}

		visitor.votes.set(input.commentId, input.choice);
		if (input.choice === "up") {
			comment.voteUpCount += 1;
		} else {
			comment.voteDownCount += 1;
		}

		return this.setVisitorCookieResult(
			{
				commentId: input.commentId,
				voteUp: comment.voteUpCount,
				voteDown: comment.voteDownCount,
				viewerVote: input.choice,
			},
			visitorResult.created,
			visitorResult.visitorKey,
		);
	}

	public async likePage(input: {
		siteKey: string;
		pageKey: string;
		pageTitle: string;
		pageUrl: string;
		visitorKey?: string;
	}) {
		const pageState = this.ensurePageState(input);
		const visitorResult = this.ensureVisitorState(pageState, input.visitorKey);
		const visitor = visitorResult.visitor;
		this.ensureWriteAllowed(pageState, visitor, "COMMENT_CAPTCHA_REQUIRED");

		if (visitor.likedPage) {
			throw new AppError(
				409,
				"PAGE_FEEDBACK_ALREADY_LIKED",
				"你已经点过赞了。",
			);
		}

		visitor.likedPage = true;
		return this.setVisitorCookieResult(
			{
				pageFeedback: {
					supportsLike: this.configuredSite.defaults.pageFeedback.allowLike,
					likeCount:
						pageState.baseLikeCount +
						[...pageState.visitorStates.values()].filter((state) => state.likedPage)
							.length,
					liked: true,
				},
			},
			visitorResult.created,
			visitorResult.visitorKey,
		);
	}
}
