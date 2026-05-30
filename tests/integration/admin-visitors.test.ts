import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	blacklistRules,
	commentRequestMetadata,
	comments,
	pageThreads,
	pageViewSessions,
	siteSettings,
	sites,
	visitors,
} from "../../src/db/schema";
import { serializeEngagementSettings } from "../../src/modules/shared/site-settings-defaults";
import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin visitors", () => {
	it("returns disabled metadata instead of visitor rows when visitor records are off", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie } = await loginAsAdmin(fixture.app);
		await fixture.app.db.update(siteSettings).set({
			engagementJson: serializeEngagementSettings({
				visitors: { enabled: false },
				pageViews: { enabled: false },
				pageLikes: { enabled: false },
				commentVotes: { enabled: false },
			}),
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/visitors?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			enabled: false,
			trustMode: "lightweight",
			items: [],
			message: "访客记录未启用。QingYan 当前不记录访客身份，也不提供访客画像。",
			pagination: {
				limit: 20,
				offset: 0,
				totalCount: 0,
			},
		});
	});

	it("lists visitor aggregates and blacklist state", async () => {
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
			visitorKey: "visitor_admin_1",
		});
		const [visitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "visitor_admin_1"));
		if (!visitor) {
			throw new Error("Expected visitor to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:visitor-1",
			pageTitle: "Visitor One",
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:visitor-1"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(pageViewSessions).values({
			pageThreadId: thread.id,
			visitorId: visitor.id,
			fingerprint: "visitor-admin-fingerprint",
			seenAt: "2026-04-17T10:00:00.000Z",
		});
		await fixture.app.db.insert(comments).values({
			id: "c_visitor_1",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: null,
			visitorId: visitor.id,
			status: "approved",
			authorName: "Alice",
			authorEmail: "alice@example.com",
			contentRaw: "hello visitor",
			contentHtml: "<p>hello visitor</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-04-17T10:00:00.000Z",
			updatedAt: "2026-04-17T10:00:00.000Z",
		});
		await fixture.app.db.insert(commentRequestMetadata).values({
			commentId: "c_visitor_1",
			authorIp: "203.0.113.30",
			authorUserAgent: "QingYan Visitor Browser",
		});
		await fixture.app.db.insert(blacklistRules).values({
			siteId: site.id,
			scope: "post",
			targetType: "visitor",
			targetValue: "visitor_admin_1",
			matchMode: "exact",
			source: "manual",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/visitors?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			items: [
				{
					visitorKey: "visitor_admin_1",
					commentCount: 1,
					pageCount: 1,
					emailCount: 1,
					emails: ["alice@example.com"],
					ips: ["203.0.113.30"],
					userAgents: ["QingYan Visitor Browser"],
					blacklist: {
						visitor: true,
					},
				},
			],
			pagination: {
				totalCount: 1,
			},
		});
	});

	it("lists request metadata for visitors without comments", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);

		const bootstrap = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:visitor-metadata&pageTitle=Visitor%20Metadata",
			headers: {
				referer: "http://localhost:4321/posts/visitor-metadata/",
				"x-forwarded-for": "203.0.113.90",
				"user-agent": "QingYan Metadata Browser",
			},
		});
		expect(bootstrap.statusCode).toBe(200);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/visitors?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			items: [
				{
					commentCount: 0,
					pageCount: 0,
					ips: [],
					userAgents: [],
					lastIp: "127.0.0.1",
					lastUserAgent: "QingYan Metadata Browser",
					lastSeenPageKey: "posts/visitor-metadata/",
					lastSeenPageUrl: "http://localhost:4321/posts/visitor-metadata/",
				},
			],
			pagination: {
				totalCount: 1,
			},
		});
	});
});
