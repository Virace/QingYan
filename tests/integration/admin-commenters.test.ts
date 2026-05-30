import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	blacklistRules,
	commentRequestMetadata,
	comments,
	pageThreads,
	sites,
} from "../../src/db/schema";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin commenters", () => {
	it("aggregates commenters by email and collects multiple nicknames", async () => {
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
			{
				id: "c_user_3",
				siteId: site.id,
				pageThreadId: secondThread.id,
				parentId: null,
				status: "approved",
				authorName: "ALICE",
				authorEmail: "Alice@Example.com",
				contentRaw: "hello 3",
				contentHtml: "<p>hello 3</p>",
				replyCount: 0,
				voteUpCount: 0,
				voteDownCount: 0,
				createdAt: "2026-04-17T10:02:00.000Z",
				updatedAt: "2026-04-17T10:02:00.000Z",
			},
		]);
		await fixture.app.db.insert(commentRequestMetadata).values({
			commentId: "c_user_1",
			authorIp: "203.0.113.20",
			authorUserAgent: "QingYan User Browser",
		});
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
			url: "/qingyan/api/admin/commenters?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			items: [
				{
					email: "alice@example.com",
					emailVariants: ["alice@example.com", "Alice@Example.com"],
					names: ["Alice", "Alicia", "ALICE"],
					commentCount: 3,
					pendingCount: 1,
					approvedCount: 2,
					pageCount: 2,
					siteCount: 1,
					ips: ["203.0.113.20"],
					userAgents: ["QingYan User Browser"],
					blacklist: {
						email: true,
					},
					isBlacklisted: true,
				},
			],
			pagination: {
				totalCount: 1,
			},
		});

		const searchResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/commenters?siteKey=fangyuan&search=alice@example.com&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(searchResponse.statusCode).toBe(200);
		expect(searchResponse.json()).toMatchObject({
			items: [
				{
					email: "alice@example.com",
					commentCount: 3,
					emailVariants: ["alice@example.com", "Alice@Example.com"],
				},
			],
			pagination: {
				totalCount: 1,
			},
		});
	});

	it("does not expose users as the canonical anonymous commenter endpoint", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/users?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(404);
	});

	it("adds and removes email blacklist rules by target", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/blacklist",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				siteKey: "fangyuan",
				targetType: "email",
				targetValue: "BLOCKED@example.com",
				matchMode: "exact",
				scope: "post",
			},
		});
		expect(createResponse.statusCode).toBe(200);
		expect(createResponse.json()).toMatchObject({
			rule: {
				targetType: "email",
				targetValue: "blocked@example.com",
				matchMode: "exact",
			},
		});

		const deleteResponse = await fixture.app.inject({
			method: "DELETE",
			url: "/qingyan/api/admin/blacklist/target",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				siteKey: "fangyuan",
				targetType: "email",
				targetValue: "blocked@example.com",
				matchMode: "exact",
			},
		});
		expect(deleteResponse.statusCode).toBe(200);
		expect(deleteResponse.json()).toMatchObject({
			rules: [
				{
					targetType: "email",
					targetValue: "blocked@example.com",
				},
			],
		});

		const rules = await fixture.app.db.select().from(blacklistRules);
		expect(rules).toHaveLength(0);
	});
});
