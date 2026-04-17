import { afterEach, describe, expect, it } from "vitest";

import { runtimeSettings } from "../../src/db/schema";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("POST /api/page-feedback/like", () => {
	it("likes a page once and blocks repeated likes from the same visitor", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const firstLike = await fixture.app.inject({
			method: "POST",
			url: "/api/page-feedback/like",
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:like",
				pageTitle: "Like Page",
				pageUrl: "https://fangyuan.example.com/posts/like/",
			},
		});

		expect(firstLike.statusCode).toBe(200);
		expect(firstLike.json()).toMatchObject({
			pageFeedback: {
				supportsLike: true,
				likeCount: 1,
				liked: true,
			},
		});

		const visitorCookie = firstLike.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const secondLike = await fixture.app.inject({
			method: "POST",
			url: "/api/page-feedback/like",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:like",
				pageTitle: "Like Page",
				pageUrl: "https://fangyuan.example.com/posts/like/",
			},
		});

		expect(secondLike.statusCode).toBe(409);
		expect(secondLike.json()).toMatchObject({
			error: {
				code: "PAGE_FEEDBACK_ALREADY_LIKED",
			},
		});
	});

	it("reuses required page captcha state for page like without counting it toward the threshold", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(runtimeSettings).set({
			captchaMode: "threshold",
			captchaThresholdWindowSec: 60,
			captchaThresholdMaxActions: 3,
		});

		const postComment = async (raw: string, cookieValue?: string) =>
			fixture.app.inject({
				method: "POST",
				url: "/api/comments",
				cookies: cookieValue
					? {
							qingyan_visitor: cookieValue,
						}
					: undefined,
				payload: {
					siteKey: "fangyuan",
					pageKey: "post:like-threshold",
					pageTitle: "Like Threshold",
					pageUrl: "https://fangyuan.example.com/posts/like-threshold/",
					parentCommentId: null,
					author: {
						name: "Alice",
					},
					content: {
						raw,
					},
					options: {
						notifyOnReply: false,
					},
				},
			});

		const first = await postComment("first");
		expect(first.statusCode).toBe(200);
		const visitorCookie = first.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const cookieValue = visitorCookie?.value ?? "";

		const second = await postComment("second", cookieValue);
		expect(second.statusCode).toBe(200);

		const third = await postComment("third", cookieValue);
		expect(third.statusCode).toBe(400);
		expect(third.json()).toMatchObject({
			error: {
				code: "COMMENT_CAPTCHA_REQUIRED",
			},
		});

		const like = await fixture.app.inject({
			method: "POST",
			url: "/api/page-feedback/like",
			cookies: {
				qingyan_visitor: cookieValue,
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:like-threshold",
				pageTitle: "Like Threshold",
				pageUrl: "https://fangyuan.example.com/posts/like-threshold/",
			},
		});

		expect(like.statusCode).toBe(400);
		expect(like.json()).toMatchObject({
			error: {
				code: "COMMENT_CAPTCHA_REQUIRED",
			},
		});
	});
});
