import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { comments, pageThreads, sites } from "../../src/db/schema";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("GET /api/comments/thread", () => {
	it("returns thread-only payload and sets a visitor cookie for new viewers", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:thread-only",
			pageTitle: "Thread Only",
			commentCount: 1,
			rootCommentCount: 1,
			pageViewCount: 0,
			pageLikeCount: 0,
		});
		const [pageThread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:thread-only"));
		if (!pageThread) {
			throw new Error("Expected page thread to exist");
		}

		await fixture.app.db.insert(comments).values({
			id: "c_thread_only",
			siteId: site.id,
			pageThreadId: pageThread.id,
			parentId: null,
			status: "approved",
			authorName: "Only Root",
			contentRaw: "thread root",
			contentHtml: "<p>thread root</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-04-17T10:02:00.000Z",
			updatedAt: "2026-04-17T10:02:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/thread?siteKey=fangyuan&pageKey=post:thread-only&sortBy=oldest&limit=20&offset=0",
			headers: {
				"user-agent": "thread-test",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(
			response.cookies.some((cookie) => cookie.name === "qingyan_visitor"),
		).toBe(true);
		expect(response.json()).toMatchObject({
			thread: {
				siteKey: "fangyuan",
				pageKey: "post:thread-only",
				pageTitle: "Thread Only",
			},
			pagination: {
				sortBy: "oldest",
				limit: 20,
				offset: 0,
				totalCount: 1,
				rootCount: 1,
			},
		});
		expect(response.json()).not.toHaveProperty("pageMetrics");
		expect(response.json()).not.toHaveProperty("pageFeedback");
		expect(response.json().comments).toHaveLength(1);
		expect(response.json().comments[0]).toMatchObject({
			id: "c_thread_only",
			viewerVote: null,
		});
	});
});
