import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	comments,
	pageThreads,
	siteSettings,
	sites,
	visitors,
} from "../../src/db/schema";
import { AdminSystemSettingsRepository } from "../../src/modules/admin/system-settings-repository";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

function refererFor(pageKey: string) {
	return {
		referer: `http://localhost:4321/${pageKey}`,
	};
}

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("GET /qingyan/api/comments/thread", () => {
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
			url: "/qingyan/api/comments/thread?siteKey=fangyuan&pageKey=post:thread-only&sortBy=oldest&limit=20&offset=0",
			headers: {
				...refererFor("post:thread-only"),
				"user-agent": "thread-test",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(
			response.cookies.some((cookie) => cookie.name === "qingyan_visitor"),
		).toBe(true);
		expect(response.json()).toMatchObject({
			pagination: {
				sortBy: "oldest",
				limit: 20,
				offset: 0,
				totalCount: 1,
				rootCount: 1,
			},
		});
		expect(response.json().thread).toBeUndefined();
		expect(response.json()).not.toHaveProperty("pageMetrics");
		expect(response.json()).not.toHaveProperty("pageFeedback");
		expect(response.json().comments).toHaveLength(1);
		expect(response.json().comments[0]).toMatchObject({
			id: "c_thread_only",
			viewerVote: null,
		});
	});

	it("returns external avatar URL from thread API when enabled", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		const systemSettings = new AdminSystemSettingsRepository(fixture.app.db);
		await systemSettings.upsert("avatar", "external.enabled", true);
		await systemSettings.upsert(
			"avatar",
			"external.baseUrl",
			"https://cravatar.cn/avatar",
		);
		await systemSettings.upsert("avatar", "external.hashAlgorithm", "md5");
		await systemSettings.upsert(
			"avatar",
			"external.query",
			"s=120&d=retro&r=pg",
		);
		await systemSettings.upsert("avatar", "display.shape", "square");
		await systemSettings.upsert("avatar", "display.sizePx", 36);

		await fixture.app.db.insert(visitors).values({
			siteId: site.id,
			visitorKey: "viewer_gravatar_thread",
		});
		const [visitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "viewer_gravatar_thread"));
		if (!visitor) {
			throw new Error("Expected visitor to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:external-avatar-thread",
			pageTitle: "External Avatar Thread",
			pageUrl: "/posts/external-avatar-thread/",
			commentCount: 1,
			rootCommentCount: 1,
		});
		const [pageThread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:external-avatar-thread"));
		if (!pageThread) {
			throw new Error("Expected page thread to exist");
		}

		const aliceMd5 = createHash("md5")
			.update("alice@example.com")
			.digest("hex");
		await fixture.app.db.insert(comments).values({
			id: "c_external_avatar_thread",
			siteId: site.id,
			pageThreadId: pageThread.id,
			parentId: null,
			visitorId: visitor.id,
			status: "approved",
			authorName: "Alice",
			authorEmail: "alice@example.com",
			contentRaw: "hello",
			contentHtml: "<p>hello</p>",
			createdAt: "2026-05-06T10:00:00.000Z",
			updatedAt: "2026-05-06T10:00:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/thread?siteKey=fangyuan&pageKey=post:external-avatar-thread",
			cookies: {
				qingyan_visitor: "viewer_gravatar_thread",
			},
			headers: refererFor("post:external-avatar-thread"),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().comments[0].author.avatarUrl).toBe(
			`https://cravatar.cn/avatar/${aliceMd5}?s=120&d=retro&r=pg`,
		);
		expect(response.json().comments[0].author.gravatarUrl).toBeUndefined();
		expect(response.json().commentDisplay).toMatchObject({
			avatar: {
				external: {
					enabled: true,
				},
			},
		});
		expect(response.json().commentDisplay.avatar.display).toBeUndefined();
	});

	it("returns normalized display metadata from thread API without raw request metadata or icon", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}
		await fixture.app.db
			.update(siteSettings)
			.set({
				commentMetadataJson: JSON.stringify({
					ipRegion: {
						enabled: true,
						precision: "province",
					},
					device: {
						display: {
							enabled: true,
						},
					},
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:thread-metadata",
			pageTitle: "Thread Metadata",
			commentCount: 1,
			rootCommentCount: 1,
		});
		const [pageThread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:thread-metadata"));
		if (!pageThread) {
			throw new Error("Expected page thread to exist");
		}

		await fixture.app.db.insert(comments).values({
			id: "c_thread_metadata",
			siteId: site.id,
			pageThreadId: pageThread.id,
			parentId: null,
			status: "approved",
			authorName: "Metadata",
			authorIp: "203.0.113.11",
			authorUserAgent: "Mozilla/5.0 thread-metadata",
			authorIpCountry: "中国",
			authorIpRegion: "广东省",
			authorIpCity: "深圳市",
			authorIpLocationRaw: "中国|广东省|深圳市|移动|CN",
			authorDeviceBrowser: "chrome",
			authorDeviceBrowserVersion: "120.0.0.0",
			authorDeviceOs: "windows",
			authorDeviceOsVersion: "10",
			authorDeviceType: "desktop",
			authorDeviceIcon: "chrome",
			contentRaw: "thread metadata",
			contentHtml: "<p>thread metadata</p>",
			createdAt: "2026-05-28T10:02:00.000Z",
			updatedAt: "2026-05-28T10:02:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/thread?siteKey=fangyuan&pageKey=post:thread-metadata",
			headers: refererFor("post:thread-metadata"),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().comments[0]).toMatchObject({
			displayMeta: {
				location: {
					label: "广东",
					precision: "province",
				},
				device: {
					browser: "chrome",
					browserVersion: "120.0.0.0",
					os: "windows",
					osVersion: "10",
					type: "desktop",
				},
			},
		});
		expect(response.json().comments[0].displayMeta.device).not.toHaveProperty(
			"icon",
		);
		const publicBody = JSON.stringify(response.json());
		expect(publicBody).not.toContain("203.0.113.11");
		expect(publicBody).not.toContain("Mozilla/5.0 thread-metadata");
		expect(publicBody).not.toContain("中国|广东省|深圳市|移动|CN");
	});
});
