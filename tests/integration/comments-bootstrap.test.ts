import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	comments,
	pageFeedbackRecords,
	pageThreads,
	siteSettings,
	sites,
	visitors,
	voteRecords,
} from "../../src/db/schema";
import { AdminSystemSettingsRepository } from "../../src/modules/admin/system-settings-repository";
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
		expect(payload.comments[0].author.gravatarUrl).toBeUndefined();
		expect(payload.comments[0].author.avatarUrl).toBeUndefined();
		expect(payload.comments[0].displayMeta).toBeUndefined();
		expect(payload.comments[0].children).toHaveLength(1);
		expect(payload.comments[0].children[0]).toMatchObject({
			id: "c_child",
			parentId: "c_root",
		});
	});

	it("returns configured display metadata without raw request metadata", async () => {
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
						precision: "city",
					},
					device: {
						display: {
							enabled: true,
						},
					},
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		await fixture.app.db.insert(visitors).values({
			siteId: site.id,
			visitorKey: "viewer_metadata",
		});
		const [visitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "viewer_metadata"));
		if (!visitor) {
			throw new Error("Expected visitor to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:metadata-display",
			pageTitle: "Metadata Display",
			pageUrl: "/posts/metadata-display/",
			commentCount: 1,
			rootCommentCount: 1,
		});
		const [pageThread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:metadata-display"));
		if (!pageThread) {
			throw new Error("Expected page thread to exist");
		}

		await fixture.app.db.insert(comments).values({
			id: "c_metadata",
			siteId: site.id,
			pageThreadId: pageThread.id,
			parentId: null,
			visitorId: visitor.id,
			status: "approved",
			authorName: "Alice",
			authorIp: "203.0.113.8",
			authorUserAgent: "Mozilla/5.0 metadata-test",
			authorIpCountry: "中国",
			authorIpRegion: "广东省",
			authorIpCity: "深圳市",
			authorIpLocationRaw: "中国|广东省|深圳市|移动|CN",
			authorDeviceBrowser: "chrome",
			authorDeviceOs: "windows",
			authorDeviceType: "desktop",
			authorDeviceIcon: "chrome",
			contentRaw: "metadata",
			contentHtml: "<p>metadata</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-05-05T10:00:00.000Z",
			updatedAt: "2026-05-05T10:00:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:metadata-display&pageTitle=Metadata&pageUrl=https://fangyuan.example.com/posts/metadata-display/",
			cookies: {
				qingyan_visitor: "viewer_metadata",
			},
		});

		expect(response.statusCode).toBe(200);
		const payload = response.json();
		expect(payload.comments[0]).toMatchObject({
			id: "c_metadata",
			displayMeta: {
				location: {
					label: "广东深圳",
					precision: "city",
				},
				device: {
					browser: "chrome",
					os: "windows",
					type: "desktop",
					icon: "chrome",
				},
			},
		});
		const publicBody = JSON.stringify(payload);
		expect(publicBody).not.toContain("203.0.113.8");
		expect(publicBody).not.toContain("Mozilla/5.0 metadata-test");
		expect(publicBody).not.toContain("中国|广东省|深圳市|移动|CN");
	});

	it("returns Gravatar URL when global Gravatar is enabled", async () => {
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
		await systemSettings.upsert("avatar", "gravatar.enabled", true);
		await systemSettings.upsert(
			"avatar",
			"gravatar.baseUrl",
			"https://cravatar.cn/avatar",
		);

		await fixture.app.db.insert(visitors).values({
			siteId: site.id,
			visitorKey: "viewer_gravatar",
		});
		const [visitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "viewer_gravatar"));
		if (!visitor) {
			throw new Error("Expected visitor to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:gravatar",
			pageTitle: "Gravatar",
			pageUrl: "/posts/gravatar/",
			commentCount: 1,
			rootCommentCount: 1,
		});
		const [pageThread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:gravatar"));
		if (!pageThread) {
			throw new Error("Expected page thread to exist");
		}

		const aliceHash =
			"ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976";
		await fixture.app.db.insert(comments).values({
			id: "c_gravatar",
			siteId: site.id,
			pageThreadId: pageThread.id,
			parentId: null,
			visitorId: visitor.id,
			status: "approved",
			authorName: "Alice",
			authorEmailHash: aliceHash,
			contentRaw: "hello",
			contentHtml: "<p>hello</p>",
			createdAt: "2026-05-06T10:00:00.000Z",
			updatedAt: "2026-05-06T10:00:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:gravatar&pageTitle=Gravatar&pageUrl=https://fangyuan.example.com/posts/gravatar/",
			cookies: {
				qingyan_visitor: "viewer_gravatar",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().comments[0].author).toMatchObject({
			name: "Alice",
			gravatarUrl: `https://cravatar.cn/avatar/${aliceHash}?s=80&d=404&r=g`,
		});
		expect(response.json().comments[0].author.avatarUrl).toBeUndefined();
	});

	it("inlines captcha challenge in bootstrap when captcha mode is always", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
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
