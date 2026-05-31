import { randomUUID } from "node:crypto";

import type { DevSiteSeed } from "../../config/runtime-options";
import { buildCommentForm } from "../comments/comment-form";
import { presentComments } from "../comments/presenter";
import { createCaptchaChallenge } from "../shared/captcha-challenge";
import { AppError, ResourceNotFoundError } from "../shared/errors";
import {
	buildDefaultSiteSettings,
	defaultCommentRequire,
} from "../shared/site-settings-defaults";
import { defaultSystemSettings } from "../system-settings/definitions";

type ScenarioName =
	| "comments-captcha-always"
	| "comments-threshold-next-write"
	| "comments-seeded-thread";

type VoteChoice = "up" | "down";
type CaptchaRequiredCode =
	| "COMMENT_CAPTCHA_REQUIRED"
	| "VOTE_CAPTCHA_REQUIRED"
	| "PAGE_FEEDBACK_CAPTCHA_REQUIRED";
type MockVoteMode = "captcha" | "blacklist" | null;

type RuntimeCommentRecord = {
	id: string;
	parentId: string | null;
	authorName: string;
	authorEmail: string | null;
	authorEmailHash: string | null;
	authorWebsite: string | null;
	contentRaw: string;
	contentHtml: string | null;
	status: "pending" | "approved";
	isPinned: boolean;
	isFolded: boolean;
	replyCount: number;
	voteUpCount: number;
	voteDownCount: number;
	mockVoteMode: MockVoteMode;
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

function createVisitorKey(): string {
	return `dev_visitor_${randomUUID()}`;
}

function normalizePageUrl(value?: string): string {
	if (!value) {
		return "https://example.test/";
	}

	return value;
}

function buildStableCommentId(
	pageKey: string,
	kind: "root" | "reply",
	index: number,
): string {
	const segment = pageKey
		.replace(/[^A-Za-z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return `dev_${segment || "page"}_${kind}_${index}`;
}

function cloneSiteForDefault(baseSite: DevSiteSeed): DevSiteSeed {
	return {
		...baseSite,
		siteKey: "default",
		name: "Default",
	};
}

function defaultCommentStatus(): "pending" | "approved" {
	return "pending";
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
	private readonly configuredSite: DevSiteSeed;

	private readonly pages = new Map<string, RuntimePageState>();

	private readonly defaultSettings = buildDefaultSiteSettings(0);

	public constructor(baseSite: DevSiteSeed) {
		this.configuredSite = cloneSiteForDefault(baseSite);
	}

	public ownsSite(siteKey: string): boolean {
		return siteKey === "default";
	}

	public getConfiguredSite(siteKey: string): DevSiteSeed | undefined {
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
		this.createDefaultThread(created);
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

	private ensureCaptcha(
		visitor: RuntimeVisitorState,
		refresh = false,
	): RuntimeCaptchaState {
		if (
			refresh ||
			!visitor.challengeId ||
			!visitor.challengeImageData ||
			!visitor.challengeAnswer
		) {
			const challenge = createCaptchaChallenge();
			visitor.challengeId = `cap_${randomUUID()}`;
			visitor.challengeAnswer = challenge.answer;
			visitor.challengeImageData = challenge.imageData;
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
		refresh = false,
	): RuntimeCaptchaState {
		if (visitor.blacklisted) {
			return {
				required: false,
				verified: false,
				mode: "inline_value",
				challenge: null,
			};
		}

		if (visitor.challengeId) {
			return this.ensureCaptcha(visitor, refresh);
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

			return this.ensureCaptcha(visitor, refresh);
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

			return this.ensureCaptcha(visitor, refresh);
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
			.filter((comment): comment is RuntimeCommentRecord =>
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
			.filter((comment): comment is RuntimeCommentRecord =>
				Boolean(comment && includedCommentIds.has(comment.id)),
			);

		return {
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
					authorEmail: comment.authorEmail ?? null,
					authorEmailHash: comment.authorEmailHash ?? null,
					updatedAt: comment.updatedAt ?? comment.createdAt,
				})),
				this.buildViewerVoteMap(input.visitor),
				{
					commentVotes: {
						enabled: true,
					},
				},
			),
		};
	}

	private buildCommentDisplay() {
		return {
			avatar: {
				external: {
					enabled: defaultSystemSettings.avatar.external.enabled,
				},
			},
		};
	}

	private buildCaptchaData(captcha: RuntimeCaptchaState) {
		return {
			required: captcha.required,
			verified: captcha.verified,
			mode: captcha.mode,
			...(captcha.challenge ? { challenge: captcha.challenge } : {}),
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
			authorEmail: null,
			authorEmailHash: null,
			authorWebsite: null,
			contentRaw: "seeded root comment",
			contentHtml: null,
			status: "approved",
			isPinned: false,
			isFolded: false,
			replyCount: 1,
			voteUpCount: 0,
			voteDownCount: 0,
			mockVoteMode: null,
			createdAt,
			updatedAt: null,
		});
		pageState.comments.set(replyId, {
			id: replyId,
			parentId: rootId,
			authorName: "Seed Reply",
			authorEmail: null,
			authorEmailHash: null,
			authorWebsite: null,
			contentRaw: "seeded reply comment",
			contentHtml: null,
			status: "approved",
			isPinned: false,
			isFolded: false,
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			mockVoteMode: null,
			createdAt,
			updatedAt: null,
		});
		pageState.commentOrder = [rootId, replyId];
	}

	private createDefaultThread(pageState: RuntimePageState) {
		pageState.comments.clear();
		pageState.commentOrder = [];
		pageState.baseLikeCount = 0;

		const addComment = (input: {
			id: string;
			parentId: string | null;
			authorName: string;
			authorWebsite?: string | null;
			contentRaw: string;
			replyCount?: number;
			voteUpCount?: number;
			voteDownCount?: number;
			mockVoteMode?: MockVoteMode;
			minute: number;
		}) => {
			pageState.comments.set(input.id, {
				id: input.id,
				parentId: input.parentId,
				authorName: input.authorName,
				authorEmail: null,
				authorEmailHash: null,
				authorWebsite: input.authorWebsite ?? null,
				contentRaw: input.contentRaw,
				contentHtml: null,
				status: "approved",
				isPinned: false,
				isFolded: false,
				replyCount: input.replyCount ?? 0,
				voteUpCount: input.voteUpCount ?? 0,
				voteDownCount: input.voteDownCount ?? 0,
				mockVoteMode: input.mockVoteMode ?? null,
				createdAt: new Date(
					Date.UTC(2026, 3, 18, 9, input.minute, 0),
				).toISOString(),
				updatedAt: null,
			});
			pageState.commentOrder.push(input.id);
		};

		const rootIds = Array.from({ length: 6 }, (_, index) =>
			buildStableCommentId(pageState.pageKey, "root", index + 1),
		);
		const replyIds = Array.from({ length: 3 }, (_, index) =>
			buildStableCommentId(pageState.pageKey, "reply", index + 1),
		);

		addComment({
			id: rootIds[0],
			parentId: null,
			authorName: "青砚",
			authorWebsite: "https://qingyan.example.test",
			contentRaw: "这是一条默认开发评论。给这条评论投票会稳定触发验证码。",
			replyCount: 2,
			voteUpCount: 3,
			mockVoteMode: "captcha",
			minute: 59,
		});
		addComment({
			id: replyIds[0],
			parentId: rootIds[0],
			authorName: "前端调试",
			contentRaw: "第一层回复用于观察嵌套评论布局。",
			replyCount: 1,
			voteUpCount: 1,
			minute: 58,
		});
		addComment({
			id: replyIds[1],
			parentId: replyIds[0],
			authorName: "清言 Mock",
			contentRaw: "第二层回复用于确认多级嵌套表现。",
			minute: 57,
		});
		addComment({
			id: rootIds[1],
			parentId: null,
			authorName: "调试访客",
			contentRaw: "这条评论的投票会稳定触发黑名单错误，用于测试失败态。",
			voteUpCount: 1,
			voteDownCount: 1,
			mockVoteMode: "blacklist",
			minute: 56,
		});
		addComment({
			id: rootIds[2],
			parentId: null,
			authorName: "Demo Visitor",
			contentRaw: "普通评论用于观察默认列表、分页和回复布局。",
			replyCount: 1,
			minute: 55,
		});
		addComment({
			id: replyIds[2],
			parentId: rootIds[2],
			authorName: "青砚",
			contentRaw: "另一条回复用于让首屏同时出现多个嵌套区域。",
			minute: 54,
		});
		for (let index = 3; index < rootIds.length; index += 1) {
			addComment({
				id: rootIds[index],
				parentId: null,
				authorName: `分页访客 ${index + 1}`,
				contentRaw: `第 ${index + 1} 条首层评论，用于稳定撑出第二页。`,
				voteUpCount: index % 2,
				minute: 53 - index,
			});
		}
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

	public async inspect(siteKey: string, pageKey: string, visitorKey?: string) {
		if (!this.ownsSite(siteKey)) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const pageState = this.pages.get(pageKey);
		const visitor = visitorKey
			? (pageState?.visitorStates.get(visitorKey) ?? null)
			: null;
		const captcha =
			pageState && visitor
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
							[...pageState.visitorStates.values()].filter(
								(state) => state.likedPage,
							).length,
					}
				: null,
			captcha,
		};
	}

	private setVisitorCookieResult<T>(
		body: T,
		created: boolean,
		visitorKey: string,
	) {
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
		const captcha = this.getCaptchaStateForVisitor(
			pageState,
			visitorResult.visitor,
		);
		const threadBody = this.buildThreadBody({
			pageState,
			visitor: visitorResult.visitor,
			sortBy: input.sortBy,
			limit: input.limit,
			offset: input.offset,
		});

		return this.setVisitorCookieResult(
			{
				schemaVersion: "2026-05-31",
				site: {
					siteKey: input.siteKey,
				},
				page: {
					pageKey: input.pageKey,
					status: "active",
				},
				features: {
					comments: { enabled: true },
					commentReplies: {
						enabled: this.defaultSettings.maxDepth > 1,
						...(this.defaultSettings.maxDepth > 1
							? { maxDepth: this.defaultSettings.maxDepth }
							: { reason: "feature_disabled" }),
					},
					commentVotes: { enabled: true },
					commentCaptcha: {
						enabled: this.defaultSettings.captchaMode !== "never",
						...(this.defaultSettings.captchaMode !== "never"
							? { mode: this.defaultSettings.captchaMode }
							: { reason: "feature_disabled" }),
					},
					pageViews: { enabled: true },
					pageLikes: { enabled: true },
					visitors: { enabled: true },
				},
				data: {
					comments: {
						form: buildCommentForm({
							allowWebsite: this.defaultSettings.allowWebsite,
							commentRequireJson: JSON.stringify(defaultCommentRequire),
						}),
						display: this.buildCommentDisplay(),
						pagination: threadBody.pagination,
						items: threadBody.comments,
						...(this.defaultSettings.captchaMode !== "never"
							? { captcha: this.buildCaptchaData(captcha) }
							: {}),
					},
					pageViews: {
						count: pageState.pageViewCount,
					},
					pageLikes: {
						count:
							pageState.baseLikeCount +
							[...pageState.visitorStates.values()].filter(
								(state) => state.likedPage,
							).length,
						liked: visitorResult.visitor.likedPage,
					},
				},
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
		const threadBody = this.buildThreadBody({
			pageState,
			visitor: visitorResult.visitor,
			sortBy: input.sortBy,
			limit: input.limit,
			offset: input.offset,
		});
		return this.setVisitorCookieResult(
			{
				display: this.buildCommentDisplay(),
				pagination: threadBody.pagination,
				items: threadBody.comments,
			},
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
		return this.readCaptchaState({
			...input,
			refresh: false,
		});
	}

	public async refreshCaptcha(input: {
		siteKey: string;
		pageKey: string;
		pageTitle?: string;
		pageUrl?: string;
		visitorKey?: string;
	}) {
		return this.readCaptchaState({
			...input,
			refresh: true,
		});
	}

	private async readCaptchaState(input: {
		siteKey: string;
		pageKey: string;
		pageTitle?: string;
		pageUrl?: string;
		refresh: boolean;
		visitorKey?: string;
	}) {
		const pageState = this.ensurePageState(input);
		const visitorResult = this.ensureVisitorState(pageState, input.visitorKey);
		return this.setVisitorCookieResult(
			this.buildCaptchaData(
				this.getCaptchaStateForVisitor(
					pageState,
					visitorResult.visitor,
					input.refresh,
				),
			),
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

	private consumeInlineCaptcha(
		_pageState: RuntimePageState,
		visitor: RuntimeVisitorState,
		input:
			| {
					challengeId: string;
					value: string;
			  }
			| null
			| undefined,
		errorCode: CaptchaRequiredCode,
	) {
		if (!input) {
			return;
		}
		if (visitor.blacklisted) {
			throw new AppError(403, "COMMENT_BLACKLISTED", "当前请求已被拒绝。");
		}
		if (!visitor.challengeId || visitor.challengeId !== input.challengeId) {
			throw new AppError(400, errorCode, "请先完成验证码验证。");
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
			authorEmail: null,
			authorEmailHash: null,
			authorWebsite: input.authorWebsite ?? null,
			contentRaw: input.contentRaw,
			contentHtml: null,
			status: defaultCommentStatus(),
			isPinned: false,
			isFolded: false,
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			mockVoteMode: null,
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
			status: defaultCommentStatus(),
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
		captcha?: {
			challengeId: string;
			value: string;
		} | null;
		visitorKey?: string;
	}) {
		const pageState = this.ensurePageState(input);
		const visitorResult = this.ensureVisitorState(pageState, input.visitorKey);
		const visitor = visitorResult.visitor;
		this.consumeInlineCaptcha(
			pageState,
			visitor,
			input.captcha,
			"COMMENT_CAPTCHA_REQUIRED",
		);
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
		captcha?: {
			challengeId: string;
			value: string;
		} | null;
		visitorKey?: string;
	}) {
		const pageState = this.ensurePageState(input);
		const visitorResult = this.ensureVisitorState(pageState, input.visitorKey);
		const visitor = visitorResult.visitor;
		this.consumeInlineCaptcha(
			pageState,
			visitor,
			input.captcha,
			"VOTE_CAPTCHA_REQUIRED",
		);
		this.ensureWriteAllowed(pageState, visitor, "VOTE_CAPTCHA_REQUIRED");

		const comment = pageState.comments.get(input.commentId);
		if (!comment) {
			throw new ResourceNotFoundError("COMMENT_NOT_FOUND", "评论不存在。");
		}
		if (comment.mockVoteMode === "blacklist") {
			throw new AppError(403, "COMMENT_BLACKLISTED", "当前请求已被拒绝。");
		}
		if (comment.mockVoteMode === "captcha" && !visitor.verified) {
			this.ensureCaptcha(visitor);
			throw new AppError(400, "VOTE_CAPTCHA_REQUIRED", "请先完成验证码验证。");
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
				vote: {
					up: comment.voteUpCount,
					down: comment.voteDownCount,
					viewer: input.choice,
				},
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
		captcha?: {
			challengeId: string;
			value: string;
		} | null;
		visitorKey?: string;
	}) {
		const pageState = this.ensurePageState(input);
		const visitorResult = this.ensureVisitorState(pageState, input.visitorKey);
		const visitor = visitorResult.visitor;
		this.consumeInlineCaptcha(
			pageState,
			visitor,
			input.captcha,
			"PAGE_FEEDBACK_CAPTCHA_REQUIRED",
		);
		this.ensureWriteAllowed(
			pageState,
			visitor,
			"PAGE_FEEDBACK_CAPTCHA_REQUIRED",
		);

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
				pageLikes: {
					count:
						pageState.baseLikeCount +
						[...pageState.visitorStates.values()].filter(
							(state) => state.likedPage,
						).length,
					liked: true,
				},
			},
			visitorResult.created,
			visitorResult.visitorKey,
		);
	}
}
