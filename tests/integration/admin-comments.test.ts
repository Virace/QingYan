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

describe("admin comments", () => {
	it("lists, updates and soft deletes comments", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const login = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/session/login",
			payload: {
				token: "replace-me",
			},
		});
		const adminCookie = login.cookies.find(
			(cookie) => cookie.name === "qingyan_admin",
		);

		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:admin-comments",
			pageTitle: "Admin Comments",
			commentCount: 1,
			rootCommentCount: 1,
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:admin-comments"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(comments).values({
			id: "c_admin_1",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: null,
			status: "pending",
			authorName: "Admin Test",
			authorEmail: "admin@example.com",
			contentRaw: "pending comment",
			contentHtml: "<p>pending comment</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-04-17T10:00:00.000Z",
			updatedAt: "2026-04-17T10:00:00.000Z",
		});

		const listResponse = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/comments?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.json()).toMatchObject({
			items: [
				{
					id: "c_admin_1",
					status: "pending",
					authorEmail: "admin@example.com",
				},
			],
			pagination: {
				totalCount: 1,
			},
		});

		const patchResponse = await fixture.app.inject({
			method: "PATCH",
			url: "/api/admin/comments/c_admin_1",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
			payload: {
				status: "approved",
				isPinned: true,
			},
		});
		expect(patchResponse.statusCode).toBe(200);
		expect(patchResponse.json()).toMatchObject({
			comment: {
				id: "c_admin_1",
				status: "approved",
				isPinned: true,
			},
		});

		const deleteResponse = await fixture.app.inject({
			method: "DELETE",
			url: "/api/admin/comments/c_admin_1",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(deleteResponse.statusCode).toBe(200);
		expect(deleteResponse.json()).toMatchObject({
			comment: {
				id: "c_admin_1",
			},
		});

		const [deletedComment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.id, "c_admin_1"));
		expect(deletedComment?.deletedAt).not.toBeNull();
	});
});
