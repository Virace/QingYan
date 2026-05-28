import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
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
import { serializeVerifiedAuthorSettings } from "../../src/modules/comments/verified-author";
import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("GET /qingyan/api/comments/bootstrap", () => {
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
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:welcome&pageTitle=Welcome&pageUrl=https://fangyuan.example.com/posts/welcome/&sortBy=newest&limit=20&offset=0",
			cookies: {
				qingyan_visitor: "viewer_seed",
			},
			headers: {
				referer: "http://localhost:4321/post:welcome",
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
		expect(response.json().thread).toBeUndefined();

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

	it("resolves imported html page keys from Referer instead of legacy query values", async () => {
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
			visitorKey: "viewer_html_import",
		});
		const [visitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "viewer_html_import"));
		if (!visitor) {
			throw new Error("Expected visitor to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "lol_voice_collation.html",
			pageTitle: "英雄联盟音频文件整理计划——15.15",
			pageUrl: "/lol_voice_collation.html",
			commentCount: 1,
			rootCommentCount: 1,
		});
		const [pageThread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "lol_voice_collation.html"));
		if (!pageThread) {
			throw new Error("Expected imported page thread to exist");
		}

		await fixture.app.db.insert(comments).values({
			id: "c_html_import",
			siteId: site.id,
			pageThreadId: pageThread.id,
			parentId: null,
			visitorId: visitor.id,
			status: "approved",
			authorName: "Alice",
			contentRaw: "imported comment",
			contentHtml: "<p>imported comment</p>",
			createdAt: "2026-05-27T10:00:00.000Z",
			updatedAt: "2026-05-27T10:00:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=lol_voice_collation&pageTitle=%E8%8B%B1%E9%9B%84%E8%81%94%E7%9B%9F%E9%9F%B3%E9%A2%91%E6%96%87%E4%BB%B6%E6%95%B4%E7%90%86%E8%AE%A1%E5%88%92%E2%80%94%E2%80%9415.15&pageUrl=https%3A%2F%2Fx-item.com%2Flol_voice_collation.html&sortBy=newest&limit=5&offset=0",
			headers: {
				referer: "http://localhost:4321/lol_voice_collation.html",
			},
			cookies: {
				qingyan_visitor: "viewer_html_import",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			pagination: {
				totalCount: 1,
				rootCount: 1,
			},
		});
		expect(response.json().thread).toBeUndefined();
		expect(response.json().comments).toHaveLength(1);
		expect(response.json().comments[0]).toMatchObject({
			id: "c_html_import",
		});

		const allThreads = await fixture.app.db.select().from(pageThreads);
		expect(allThreads.map((thread) => thread.pageKey).sort()).toEqual([
			"lol_voice_collation.html",
		]);
	});

	it("does not create page threads for unknown bootstrap pages", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageTitle=Unknown",
			headers: {
				referer: "http://localhost:4321/posts/unknown-bootstrap/",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			pagination: {
				totalCount: 0,
				rootCount: 0,
			},
			pageMetrics: {
				pageViewCount: 0,
			},
			pageFeedback: {
				likeCount: 0,
				liked: false,
			},
		});
		expect(response.json().thread).toBeUndefined();
		expect(response.json().comments).toEqual([]);
		expect(await fixture.app.db.select().from(pageThreads)).toEqual([]);
	});

	it("rejects bootstrap requests without Referer", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageTitle=Missing",
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "PUBLIC_REFERER_REQUIRED",
			},
		});
	});

	it("rejects bootstrap requests from a foreign Referer origin", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageTitle=Foreign",
			headers: {
				referer: "https://evil.example/posts/foreign/",
			},
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "PUBLIC_REFERER_FORBIDDEN",
			},
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
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:metadata-display&pageTitle=Metadata&pageUrl=https://fangyuan.example.com/posts/metadata-display/",
			cookies: {
				qingyan_visitor: "viewer_metadata",
			},
			headers: {
				referer: "http://localhost:4321/post:metadata-display",
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

	it("returns external avatar URL when enabled", async () => {
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
			"s=160&d=identicon&f=y",
		);
		await systemSettings.upsert("avatar", "display.shape", "rounded");
		await systemSettings.upsert("avatar", "display.sizePx", 48);

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

		const aliceMd5 = createHash("md5")
			.update("alice@example.com")
			.digest("hex");
		await fixture.app.db.insert(comments).values({
			id: "c_gravatar",
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
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:gravatar&pageTitle=Gravatar&pageUrl=https://fangyuan.example.com/posts/gravatar/",
			cookies: {
				qingyan_visitor: "viewer_gravatar",
			},
			headers: {
				referer: "http://localhost:4321/post:gravatar",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().comments[0].author).toMatchObject({
			name: "Alice",
			avatarUrl: `https://cravatar.cn/avatar/${aliceMd5}?s=160&d=identicon&f=y`,
		});
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

	it("returns configured avatar display hints only when advisory fields are enabled", async () => {
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
		await systemSettings.upsert("publicApi", "advisoryFields.enabled", true);
		await systemSettings.upsert("avatar", "display.shape", "rounded");
		await systemSettings.upsert("avatar", "display.sizePx", 48);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:avatar-hints&pageTitle=Avatar%20Hints&pageUrl=https://fangyuan.example.com/posts/avatar-hints/",
			headers: {
				referer: "http://localhost:4321/post:avatar-hints",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().commentDisplay).toMatchObject({
			avatar: {
				external: {
					enabled: false,
				},
				display: {
					shape: "rounded",
					sizePx: 48,
				},
			},
		});
	});

	it("returns verified author badge from the current site settings", async () => {
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
				verifiedAuthorJson: serializeVerifiedAuthorSettings({
					enabled: true,
					displayName: "Virace",
					email: "owner@example.com",
					website: "https://fangyuan.example.com/about",
					badgeLabel: "楼主",
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		await fixture.app.db.insert(visitors).values({
			siteId: site.id,
			visitorKey: "viewer_verified_badge",
		});
		const [visitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "viewer_verified_badge"));
		if (!visitor) {
			throw new Error("Expected visitor to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:verified-badge",
			pageTitle: "Verified Badge",
			pageUrl: "/posts/verified-badge/",
			commentCount: 1,
			rootCommentCount: 1,
		});
		const [pageThread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:verified-badge"));
		if (!pageThread) {
			throw new Error("Expected page thread to exist");
		}

		await fixture.app.db.insert(comments).values({
			id: "c_verified_badge",
			siteId: site.id,
			pageThreadId: pageThread.id,
			parentId: null,
			visitorId: visitor.id,
			authorIdentity: "verified",
			status: "approved",
			authorName: "Virace",
			contentRaw: "verified",
			contentHtml: "<p>verified</p>",
			createdAt: "2026-05-09T10:00:00.000Z",
			updatedAt: "2026-05-09T10:00:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:verified-badge&pageTitle=Verified%20Badge&pageUrl=https://fangyuan.example.com/posts/verified-badge/",
			cookies: {
				qingyan_visitor: "viewer_verified_badge",
			},
			headers: {
				referer: "http://localhost:4321/post:verified-badge",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().comments[0].author.badge).toEqual({
			label: "楼主",
		});

		await fixture.app.db
			.update(siteSettings)
			.set({
				verifiedAuthorJson: serializeVerifiedAuthorSettings({
					enabled: true,
					displayName: "Virace",
					email: "owner@example.com",
					website: "https://fangyuan.example.com/about",
					badgeLabel: "博主",
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		const updatedResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:verified-badge&pageTitle=Verified%20Badge&pageUrl=https://fangyuan.example.com/posts/verified-badge/",
			cookies: {
				qingyan_visitor: "viewer_verified_badge",
			},
			headers: {
				referer: "http://localhost:4321/post:verified-badge",
			},
		});

		expect(updatedResponse.statusCode).toBe(200);
		expect(updatedResponse.json().comments[0].author.badge).toEqual({
			label: "博主",
		});
	});

	it("returns minimal verified author viewer only for logged-in admin", async () => {
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
				verifiedAuthorJson: serializeVerifiedAuthorSettings({
					enabled: true,
					displayName: "Virace",
					email: "owner@example.com",
					website: "https://fangyuan.example.com/about",
					badgeLabel: "楼主",
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		const publicResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:viewer-state&pageTitle=Viewer&pageUrl=https://fangyuan.example.com/posts/viewer-state/",
			headers: {
				referer: "http://localhost:4321/post:viewer-state",
			},
		});
		expect(publicResponse.statusCode).toBe(200);
		expect(publicResponse.json().viewer).toEqual({});

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const adminResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:viewer-state&pageTitle=Viewer&pageUrl=https://fangyuan.example.com/posts/viewer-state/",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			headers: {
				referer: "http://localhost:4321/post:viewer-state",
			},
		});

		expect(adminResponse.statusCode).toBe(200);
		expect(adminResponse.json().viewer).toEqual({
			verifiedAuthor: {
				displayName: "Virace",
				badgeLabel: "楼主",
			},
		});
	});

	it("inlines captcha challenge in bootstrap when captcha mode is always", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "always",
		});
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}
		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:always",
			pageTitle: "Always",
			pageUrl: "/post:always",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:always&pageTitle=Always&pageUrl=https://fangyuan.example.com/posts/always/",
			headers: {
				referer: "http://localhost:4321/post:always",
			},
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

	it("accepts legacy path-only pageUrl in bootstrap requests without storing unknown pages", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:path-only-bootstrap&pageTitle=Path%20Only&pageUrl=%2Fposts%2Fpath-only-bootstrap%2F",
			headers: {
				referer: "http://localhost:4321/post:path-only-bootstrap",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().thread).toBeUndefined();
		expect(await fixture.app.db.select().from(pageThreads)).toEqual([]);
	});
});
