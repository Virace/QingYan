import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
	comments,
	pageThreads,
	pageViewSessions,
	sitePageRegistry,
	sites,
	visitors,
} from "../../src/db/schema";
import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin pages", () => {
	it("lists page management aggregates", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		await fixture.app.db.insert(visitors).values({
			siteId: site.id,
			visitorKey: "visitor_pages_1",
		});
		const [visitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "visitor_pages_1"));
		if (!visitor) {
			throw new Error("Expected visitor to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:welcome",
			pageTitle: "Welcome",
			pageUrl: "/posts/welcome/",
			commentCount: 1,
			rootCommentCount: 1,
			pageLikeCount: 2,
			updatedAt: "2026-04-17T10:00:00.000Z",
		});
		await fixture.app.db.insert(sitePageRegistry).values({
			siteId: site.id,
			pageKey: "post:welcome",
			pageUrl: "/posts/welcome/",
			title: "Welcome",
			status: "active",
			updatedAt: "2026-04-17T10:00:00.000Z",
		});
		await fixture.app.db.insert(sitePageRegistry).values({
			siteId: site.id,
			pageKey: "post:registry-only",
			pageUrl: "/posts/registry-only/",
			title: "Registry Only",
			status: "active",
			updatedAt: "2026-04-18T10:00:00.000Z",
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:welcome"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(pageViewSessions).values({
			pageThreadId: thread.id,
			visitorId: visitor.id,
			fingerprint: "page-fingerprint-1",
			seenAt: "2026-04-17T10:00:00.000Z",
		});
		await fixture.app.db.insert(comments).values({
			id: "c_pages_1",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: null,
			visitorId: visitor.id,
			status: "approved",
			authorName: "Alice",
			authorEmail: "alice@example.com",
			contentRaw: "hello page",
			contentHtml: "<p>hello page</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-04-17T10:00:00.000Z",
			updatedAt: "2026-04-17T10:00:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/pages?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			items: [
				{
					pageKey: "post:registry-only",
					pageTitle: "Registry Only",
					pageUrl: "http://localhost:4321/posts/registry-only/",
					commentCount: 0,
					rootCommentCount: 0,
					pageLikeCount: 0,
					visitorCount: 0,
					userCount: 0,
				},
				{
					pageKey: "post:welcome",
					pageTitle: "Welcome",
					pageUrl: "http://localhost:4321/posts/welcome/",
					commentCount: 1,
					rootCommentCount: 1,
					pageLikeCount: 2,
					visitorCount: 1,
					userCount: 1,
				},
			],
			pagination: {
				totalCount: 2,
			},
		});
	});
});
