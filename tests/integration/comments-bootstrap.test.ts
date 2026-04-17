import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	comments,
	pageFeedbackRecords,
	pageThreads,
	runtimeSettings,
	sites,
	visitors,
	voteRecords,
} from "../../src/db/schema";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("GET /api/comments/bootstrap", () => {
	it("returns bootstrap payload with threaded comments, viewer vote and page feedback", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		await fixture.app.db.insert(visitors).values({
			siteId: site.id,
			visitorKey: "viewer_seed",
		});
		const [visitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "viewer_seed"));
		if (!visitor) {
			throw new Error("Expected visitor to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:welcome",
			pageTitle: "Welcome",
			pageUrl: "/posts/welcome/",
			commentCount: 2,
			rootCommentCount: 1,
			pageViewCount: 5,
			pageLikeCount: 1,
		});
		const [pageThread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:welcome"));
		if (!pageThread) {
			throw new Error("Expected page thread to exist");
		}

		await fixture.app.db.insert(comments).values([
			{
				id: "c_root",
				siteId: site.id,
				pageThreadId: pageThread.id,
				parentId: null,
				visitorId: visitor.id,
				status: "approved",
				authorName: "Alice",
				contentRaw: "hello",
				contentHtml: "<p>hello</p>",
				replyCount: 1,
				voteUpCount: 1,
				voteDownCount: 0,
				createdAt: "2026-04-17T10:00:00.000Z",
				updatedAt: "2026-04-17T10:00:00.000Z",
			},
			{
				id: "c_child",
				siteId: site.id,
				pageThreadId: pageThread.id,
				parentId: "c_root",
				visitorId: visitor.id,
				status: "approved",
				authorName: "Bob",
				contentRaw: "reply",
				contentHtml: "<p>reply</p>",
				replyCount: 0,
				voteUpCount: 0,
				voteDownCount: 0,
				createdAt: "2026-04-17T10:01:00.000Z",
				updatedAt: "2026-04-17T10:01:00.000Z",
			},
		]);
		await fixture.app.db.insert(voteRecords).values({
			commentId: "c_root",
			visitorId: visitor.id,
			choice: "up",
		});
		await fixture.app.db.insert(pageFeedbackRecords).values({
			pageThreadId: pageThread.id,
			visitorId: visitor.id,
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:welcome&pageTitle=Welcome&pageUrl=https://fangyuan.example.com/posts/welcome/&sortBy=newest&limit=20&offset=0",
			cookies: {
				qingyan_visitor: "viewer_seed",
			},
			headers: {
				"user-agent": "bootstrap-test",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			capability: {
				enabled: true,
				supportsReply: true,
				supportsVote: true,
				supportsCaptcha: true,
				defaultStatus: "pending",
			},
			commentForm: {
				allow: ["nickname", "email", "website"],
				require: ["nickname", "email"],
			},
			thread: {
				siteKey: "fangyuan",
				pageKey: "post:welcome",
				pageTitle: "Welcome",
			},
			pagination: {
				sortBy: "newest",
				limit: 20,
				offset: 0,
				totalCount: 2,
				rootCount: 1,
			},
			pageMetrics: {
				pageViewCount: 6,
			},
			pageFeedback: {
				supportsLike: true,
				likeCount: 1,
				liked: true,
			},
			captcha: {
				required: false,
				verified: false,
				mode: "inline_value",
				challenge: null,
			},
		});
		expect(response.json().capability.requiredAuthorFields).toBeUndefined();
		expect(response.json().capability.optionalAuthorFields).toBeUndefined();

		const payload = response.json();
		expect(payload.comments).toHaveLength(1);
		expect(payload.comments[0]).toMatchObject({
			id: "c_root",
			viewerVote: "up",
		});
		expect(payload.comments[0].children).toHaveLength(1);
		expect(payload.comments[0].children[0]).toMatchObject({
			id: "c_child",
			parentId: "c_root",
		});
	});

	it("inlines captcha challenge in bootstrap when captcha mode is always", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(runtimeSettings).set({
			captchaMode: "always",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:always&pageTitle=Always&pageUrl=https://fangyuan.example.com/posts/always/",
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			captcha: {
				required: true,
				verified: false,
				mode: "inline_value",
			},
		});
		expect(response.json().captcha.challenge.challengeId).toMatch(/^cap_/);
	});

	it("accepts path-only pageUrl in bootstrap requests and stores the normalized path", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:path-only-bootstrap&pageTitle=Path%20Only&pageUrl=%2Fposts%2Fpath-only-bootstrap%2F",
		});

		expect(response.statusCode).toBe(200);

		const [pageThread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:path-only-bootstrap"));
		expect(pageThread?.pageUrl).toBe("/posts/path-only-bootstrap/");
	});
});
