import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { comments, pageThreads, sites } from "../../src/db/schema";
import { AdminRepository } from "../../src/modules/admin/repository";
import { CommentsRepository } from "../../src/modules/comments/repository";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("notification chain test data isolation", () => {
	it("keeps internal threads and comments out of public and ordinary admin reads", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		const [thread] = await fixture.app.db
			.insert(pageThreads)
			.values({
				siteId: site.id,
				pageKey: "notification-test:run-isolation",
				pageTitle: "QingYan 评论通知链路测试",
				pageUrl: null,
				kind: "notification_test",
				commentCount: 2,
				rootCommentCount: 1,
			})
			.returning();
		if (!thread) {
			throw new Error("Expected internal page thread to exist");
		}
		await fixture.app.db.insert(comments).values([
			{
				id: "notification_test_root",
				siteId: site.id,
				pageThreadId: thread.id,
				status: "approved",
				authorName: "链路测试评论者",
				authorEmail: "chain-test@example.com",
				contentRaw: "评论通知链路测试 A",
				contentHtml: "<p>评论通知链路测试 A</p>",
			},
			{
				id: "notification_test_reply",
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: "notification_test_root",
				status: "approved",
				authorName: "QingYan 站点人员",
				contentRaw: "评论通知链路测试回复",
				contentHtml: "<p>评论通知链路测试回复</p>",
			},
		]);

		const commentsRepository = new CommentsRepository(
			fixture.app.db,
			fixture.app.siteRegistry,
		);
		expect(
			await commentsRepository.getPageThread({
				siteId: site.id,
				pageKey: thread.pageKey,
			}),
		).toBeUndefined();
		expect(
			await commentsRepository.listPublicComments({
				pageThreadId: thread.id,
				sortBy: "newest",
				limit: 20,
				offset: 0,
			}),
		).toMatchObject({
			totalCount: 0,
			rootCount: 0,
			comments: [],
		});
		const adminRepository = new AdminRepository(fixture.app.db);
		expect(await adminRepository.getOverviewStats()).toMatchObject({
			pageCount: 0,
			commentCount: 0,
			pendingCommentCount: 0,
			commenterCount: 0,
		});
		expect(
			await adminRepository.listComments({
				siteId: site.id,
				limit: 20,
				offset: 0,
			}),
		).toMatchObject({
			items: [],
			totalCount: 0,
		});
		expect(
			await adminRepository.listPages({
				siteId: site.id,
				sortBy: "updatedAt",
				sortOrder: "desc",
				limit: 20,
				offset: 0,
			}),
		).toMatchObject({
			items: [],
			totalCount: 0,
		});
		expect(
			await adminRepository.listCommenters({
				siteId: site.id,
				limit: 20,
				offset: 0,
			}),
		).toMatchObject({
			items: [],
			totalCount: 0,
		});
		expect(
			await adminRepository.listVisitors({
				siteId: site.id,
				limit: 20,
				offset: 0,
			}),
		).toMatchObject({
			items: [],
			totalCount: 0,
		});
		expect(await adminRepository.listSitesSummary()).toEqual([
			expect.objectContaining({
				siteKey: "fangyuan",
				pageCount: 0,
				commentCount: 0,
				commenterCount: 0,
				visitorCount: 0,
			}),
		]);

		const publicBootstrap = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageTitle=Internal",
			headers: {
				referer: `http://localhost:4321/${thread.pageKey}`,
			},
		});
		expect(JSON.stringify(publicBootstrap.json())).not.toContain(
			"notification_test_root",
		);
		expect(
			await fixture.app.db
				.select()
				.from(comments)
				.where(eq(comments.pageThreadId, thread.id)),
		).toHaveLength(2);
	});
});
