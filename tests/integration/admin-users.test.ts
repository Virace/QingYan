import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	blacklistRules,
	comments,
	pageThreads,
	sites,
} from "../../src/db/schema";
import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin users", () => {
	it("aggregates users by email and collects multiple nicknames", async () => {
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

		await fixture.app.db.insert(pageThreads).values([
			{
				siteId: site.id,
				pageKey: "post:user-1",
				pageTitle: "User One",
			},
			{
				siteId: site.id,
				pageKey: "post:user-2",
				pageTitle: "User Two",
			},
		]);
		const threads = await fixture.app.db.select().from(pageThreads);
		const firstThread = threads[0];
		const secondThread = threads[1];
		if (!firstThread || !secondThread) {
			throw new Error("Expected both threads to exist");
		}

		await fixture.app.db.insert(comments).values([
			{
				id: "c_user_1",
				siteId: site.id,
				pageThreadId: firstThread.id,
				parentId: null,
				status: "approved",
				authorName: "Alice",
				authorEmail: "alice@example.com",
				contentRaw: "hello 1",
				contentHtml: "<p>hello 1</p>",
				replyCount: 0,
				voteUpCount: 0,
				voteDownCount: 0,
				createdAt: "2026-04-17T10:00:00.000Z",
				updatedAt: "2026-04-17T10:00:00.000Z",
			},
			{
				id: "c_user_2",
				siteId: site.id,
				pageThreadId: secondThread.id,
				parentId: null,
				status: "pending",
				authorName: "Alicia",
				authorEmail: "alice@example.com",
				contentRaw: "hello 2",
				contentHtml: "<p>hello 2</p>",
				replyCount: 0,
				voteUpCount: 0,
				voteDownCount: 0,
				createdAt: "2026-04-17T10:01:00.000Z",
				updatedAt: "2026-04-17T10:01:00.000Z",
			},
		]);
		await fixture.app.db.insert(blacklistRules).values({
			siteId: site.id,
			scope: "post",
			targetType: "email",
			targetValue: "alice@example.com",
			matchMode: "exact",
			source: "manual",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/users?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			items: [
				{
					email: "alice@example.com",
					names: ["Alice", "Alicia"],
					commentCount: 2,
					pendingCount: 1,
					approvedCount: 1,
					pageCount: 2,
					siteCount: 1,
					isBlacklisted: true,
				},
			],
			pagination: {
				totalCount: 1,
			},
		});
	});
});
