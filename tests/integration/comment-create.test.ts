import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
	captchaSessions,
	commentRequestMetadata,
	comments,
	pageThreads,
	sitePageRegistry,
	siteSettings,
	sites,
	visitors,
} from "../../src/db/schema";
import { AdminSystemSettingsRepository } from "../../src/modules/admin/system-settings-repository";
import { serializeEngagementSettings } from "../../src/modules/shared/site-settings-defaults";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

function refererFor(pageKey: string) {
	return {
		referer: `http://localhost:4321/${pageKey}`,
	};
}

type TestFixture = Awaited<ReturnType<typeof createTestApp>>;

async function seedActivePage(fixture: TestFixture, pageKey: string) {
	const [site] = await fixture.app.db
		.select()
		.from(sites)
		.where(eq(sites.siteKey, "fangyuan"));
	if (!site) {
		throw new Error("Expected site to exist");
	}
	await fixture.app.db.insert(sitePageRegistry).values({
		siteId: site.id,
		pageKey,
		pageUrl: `/${pageKey}`,
		status: "active",
	});
}

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("POST /qingyan/api/comments", () => {
	it("rejects comments for pages missing from the registry without creating a page thread", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: refererFor("posts/unregistered-comment/"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "posts/unregistered-comment/",
				pageTitle: "Unregistered Comment",
				pageUrl: "https://fangyuan.example.com/posts/unregistered-comment/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "must not create thread",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "PAGE_NOT_REGISTERED",
			},
		});
		expect(await fixture.app.db.select().from(pageThreads)).toEqual([]);
	});

	it("rejects comments for trashed registry pages without creating a page thread", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}
		await fixture.app.db.insert(sitePageRegistry).values({
			siteId: site.id,
			pageKey: "posts/trashed-comment/",
			pageUrl: "/posts/trashed-comment/",
			status: "trash",
			trashedAt: "2026-05-29T00:00:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: refererFor("posts/trashed-comment/"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "posts/trashed-comment/",
				pageTitle: "Trashed",
				pageUrl: "https://fangyuan.example.com/posts/trashed-comment/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "blocked",
				},
			},
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "PAGE_NOT_INTERACTIVE",
			},
		});
		expect(await fixture.app.db.select().from(pageThreads)).toEqual([]);
	});

	it("rejects a dangerous author website scheme", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
		});
		await seedActivePage(fixture, "post:dangerous-website");

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: refererFor("post:dangerous-website"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:dangerous-website",
				pageTitle: "Dangerous Website",
				pageUrl: "https://fangyuan.example.com/posts/dangerous-website/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
					website: "javascript:alert(1)",
				},
				content: {
					raw: "hello qingyan",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "COMMENT_WEBSITE_URL_INVALID",
			},
		});
	});

	it("requires captcha before allowing comment creation", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "always",
		});
		await seedActivePage(fixture, "post:create-comment-no-captcha");

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: refererFor("post:create-comment-no-captcha"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:create-comment-no-captcha",
				pageTitle: "Create Comment",
				pageUrl: "https://fangyuan.example.com/posts/create-comment/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "hello qingyan",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "COMMENT_CAPTCHA_REQUIRED",
			},
		});
	});

	it("creates a pending comment when captcha is submitted with the write action", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "always",
		});
		await seedActivePage(fixture, "post:create-comment");

		const blocked = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: refererFor("post:create-comment"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:create-comment",
				pageTitle: "Create Comment",
				pageUrl: "https://fangyuan.example.com/posts/create-comment/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "hello qingyan",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});
		expect(blocked.statusCode).toBe(400);
		expect(blocked.json()).toMatchObject({
			error: {
				code: "COMMENT_CAPTCHA_REQUIRED",
			},
		});

		const stateResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:create-comment",
			headers: refererFor("post:create-comment"),
		});
		const visitorCookie = stateResponse.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const challengeId = stateResponse.json().challenge.challengeId as string;
		const [session] = await fixture.app.db
			.select()
			.from(captchaSessions)
			.where(eq(captchaSessions.id, challengeId));
		if (!session) {
			throw new Error("Expected captcha session to exist");
		}
		const payload = JSON.parse(session.challengePayloadJson ?? "{}") as {
			answer: string;
			publicChallenge: {
				imageData: string;
			};
		};

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: refererFor("post:create-comment"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:create-comment",
				pageTitle: "Create Comment",
				pageUrl: "https://fangyuan.example.com/posts/create-comment/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "hello qingyan",
				},
				options: {
					notifyOnReply: false,
				},
				captcha: {
					challengeId,
					value: payload.answer,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			comment: {
				status: "pending",
				content: {
					raw: "hello qingyan",
					html: "<p>hello qingyan</p>",
				},
				author: {
					name: "Alice",
				},
				viewerVote: null,
				children: [],
			},
			thread: {
				commentCount: 1,
				rootCommentCount: 1,
			},
		});

		const [comment] = await fixture.app.db.select().from(comments);
		expect(comment?.contentRaw).toBe("hello qingyan");
		expect(comment?.status).toBe("pending");
		expect(comment?.authorEmail).toBe("alice@example.com");

		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:create-comment"));
		expect(thread?.commentCount).toBe(1);
		expect(thread?.rootCommentCount).toBe(1);
		expect(thread?.pageUrl).toBe("/post:create-comment");
	});

	it("accepts path-only pageUrl input and stores the normalized path", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
		});
		await seedActivePage(fixture, "post:path-only-comment");

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: refererFor("post:path-only-comment"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:path-only-comment",
				pageTitle: "Path Only Comment",
				pageUrl: "/posts/path-only-comment/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "path only page url",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(200);

		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:path-only-comment"));
		expect(thread?.pageUrl).toBe("/post:path-only-comment");
	});

	it("stores request ip and user agent and returns only normalized display metadata when enabled", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.server.trustProxy = true;
			},
		});
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
			commentMetadataJson: JSON.stringify({
				ipRegion: {
					enabled: false,
				},
				device: {
					display: {
						enabled: true,
					},
				},
			}),
		});
		await seedActivePage(fixture, "post:request-metadata");

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				...refererFor("post:request-metadata"),
				"user-agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
				"x-forwarded-for": "203.0.113.8",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:request-metadata",
				pageTitle: "Request Metadata",
				pageUrl: "https://fangyuan.example.com/posts/request-metadata/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "request metadata",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		const [comment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.contentRaw, "request metadata"));
		const [metadata] = await fixture.app.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, comment?.id ?? ""));
		expect(metadata?.authorIp).toBe("203.0.113.8");
		expect(metadata?.authorUserAgent).toBe(
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		);
		expect(metadata?.deviceSource).toBe("ua-parser-js");
		expect(metadata?.deviceError).toBeNull();
		expect(response.json().comment).toMatchObject({
			displayMeta: {
				device: {
					browser: "chrome",
					browserVersion: "120.0.0.0",
					os: "windows",
					osVersion: "10",
					type: "desktop",
				},
			},
		});
		expect(response.json().comment.displayMeta.device).not.toHaveProperty(
			"icon",
		);
		const publicBody = JSON.stringify(response.json());
		expect(publicBody).not.toContain("203.0.113.8");
		expect(publicBody).not.toContain("Mozilla/5.0 (Windows NT 10.0");
	});

	it("does not write device metadata when comment user-agent is missing", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.server.trustProxy = true;
			},
		});
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
			commentMetadataJson: JSON.stringify({
				device: {
					display: {
						enabled: true,
					},
				},
			}),
		});
		await seedActivePage(fixture, "post:missing-ua-comment");

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				...refererFor("post:missing-ua-comment"),
				"user-agent": "",
				"x-forwarded-for": "203.0.113.33",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:missing-ua-comment",
				pageTitle: "Missing UA Comment",
				pageUrl: "https://fangyuan.example.com/posts/missing-ua-comment/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "missing ua comment",
				},
			},
		});

		expect(response.statusCode).toBe(200);
		const [comment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.contentRaw, "missing ua comment"));
		const [metadata] = await fixture.app.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, comment?.id ?? ""));
		expect(metadata?.authorIp).toBe("203.0.113.33");
		expect(metadata?.authorUserAgent ?? null).toBeNull();
		expect(metadata?.deviceBrowser ?? null).toBeNull();
		expect(metadata?.deviceOs ?? null).toBeNull();
		expect(metadata?.deviceType ?? null).toBeNull();
		expect(metadata?.deviceSource ?? null).toBeNull();
	});

	it("creates comments without visitor records when visitor tracking is disabled", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.server.trustProxy = true;
			},
		});
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
			engagementJson: serializeEngagementSettings({
				visitors: { enabled: false },
				pageViews: { enabled: false },
				pageLikes: { enabled: false },
				commentVotes: { enabled: false },
			}),
			commentMetadataJson: JSON.stringify({
				device: {
					display: {
						enabled: true,
					},
				},
			}),
		});
		await seedActivePage(fixture, "post:comment-lightweight-visitor");

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				...refererFor("post:comment-lightweight-visitor"),
				"user-agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
				"x-forwarded-for": "203.0.113.12",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:comment-lightweight-visitor",
				pageTitle: "Comment Without Visitor",
				pageUrl:
					"https://fangyuan.example.com/posts/comment-lightweight-visitor/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "comment without visitor",
				},
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.cookies).not.toContainEqual(
			expect.objectContaining({ name: "qingyan_visitor" }),
		);
		const [comment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.contentRaw, "comment without visitor"));
		expect(comment?.visitorId).toBeNull();
		expect(await fixture.app.db.select().from(visitors)).toEqual([]);
		const [metadata] = await fixture.app.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, comment?.id ?? ""));
		expect(metadata?.authorIp).toBe("203.0.113.12");
		expect(metadata?.authorUserAgent).toContain("Chrome/120.0.0.0");
	});

	it("honors raw request metadata collection switches", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.server.trustProxy = true;
			},
		});
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
			commentMetadataJson: JSON.stringify({
				collectIp: false,
				collectUserAgent: false,
			}),
		});
		await seedActivePage(fixture, "post:request-metadata-disabled");

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				...refererFor("post:request-metadata-disabled"),
				"user-agent": "Mozilla/5.0 disabled-metadata-test",
				"x-forwarded-for": "203.0.113.9",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:request-metadata-disabled",
				pageTitle: "Request Metadata Disabled",
				pageUrl:
					"https://fangyuan.example.com/posts/request-metadata-disabled/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "request metadata disabled",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		const [comment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.contentRaw, "request metadata disabled"));
		const [metadata] = await fixture.app.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, comment?.id ?? ""));
		expect(metadata).toBeUndefined();
	});

	it("honors DB site settings request metadata switches", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.server.trustProxy = true;
			},
		});
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
			commentMetadataJson: JSON.stringify({
				collectIp: false,
				collectUserAgent: false,
			}),
		});
		await seedActivePage(fixture, "post:runtime-metadata-disabled");

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				...refererFor("post:runtime-metadata-disabled"),
				"user-agent": "Mozilla/5.0 runtime-disabled-metadata-test",
				"x-forwarded-for": "203.0.113.42",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:runtime-metadata-disabled",
				pageTitle: "Runtime Metadata Disabled",
				pageUrl:
					"https://fangyuan.example.com/posts/runtime-metadata-disabled/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "runtime metadata disabled",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		const [comment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.contentRaw, "runtime metadata disabled"));
		const [metadata] = await fixture.app.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, comment?.id ?? ""));
		expect(metadata).toBeUndefined();
	});

	it("keeps comment creation available when ip region database is missing", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.server.trustProxy = true;
			},
		});
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
			commentMetadataJson: JSON.stringify({
				ipRegion: {
					enabled: true,
				},
			}),
		});
		await seedActivePage(fixture, "post:missing-region-db");
		const systemSettings = new AdminSystemSettingsRepository(fixture.app.db);
		await systemSettings.upsert("ipRegion", "enabled", true);
		await systemSettings.upsert(
			"ipRegion",
			"ipv4.dbPath",
			"./data/missing-ip2region-v4.xdb",
		);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				...refererFor("post:missing-region-db"),
				"user-agent": "Mozilla/5.0 metadata-test",
				"x-forwarded-for": "203.0.113.10",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:missing-region-db",
				pageTitle: "Missing Region DB",
				pageUrl: "https://fangyuan.example.com/posts/missing-region-db/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "missing region db",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		const [comment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.contentRaw, "missing region db"));
		const [metadata] = await fixture.app.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, comment?.id ?? ""));
		expect(metadata?.authorIp).toBe("203.0.113.10");
		expect(metadata?.ipLocationError).toBe("xdb_not_found");
		expect(metadata?.ipCountry).toBeNull();
	});

	it("derives ip location metadata even when location display is disabled", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.server.trustProxy = true;
			},
		});
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
			commentMetadataJson: JSON.stringify({
				ipRegion: {
					enabled: false,
				},
			}),
		});
		await seedActivePage(fixture, "post:display-disabled-location");
		const systemSettings = new AdminSystemSettingsRepository(fixture.app.db);
		await systemSettings.upsert(
			"ipRegion",
			"ipv4.dbPath",
			"./data/missing-ip2region-v4.xdb",
		);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				...refererFor("post:display-disabled-location"),
				"x-forwarded-for": "203.0.113.11",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:display-disabled-location",
				pageTitle: "Display Disabled Location",
				pageUrl:
					"https://fangyuan.example.com/posts/display-disabled-location/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "display disabled location",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		const [comment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.contentRaw, "display disabled location"));
		const [metadata] = await fixture.app.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, comment?.id ?? ""));
		expect(metadata?.authorIp).toBe("203.0.113.11");
		expect(metadata?.ipLocationError).toBe("xdb_not_found");
		expect(response.json().comment.displayMeta?.location).toBeUndefined();
	});

	it("requires captcha on the third write attempt in threshold mode", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "threshold",
			captchaThresholdWindowSec: 60,
			captchaThresholdMaxActions: 3,
		});
		await seedActivePage(fixture, "post:threshold-comment");

		const first = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: refererFor("post:threshold-comment"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:threshold-comment",
				pageTitle: "Threshold Comment",
				pageUrl: "https://fangyuan.example.com/posts/threshold-comment/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "first",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});
		expect(first.statusCode).toBe(200);

		const visitorCookie = first.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const requestBase = {
			method: "POST" as const,
			url: "/qingyan/api/comments",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: refererFor("post:threshold-comment"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:threshold-comment",
				pageTitle: "Threshold Comment",
				pageUrl: "https://fangyuan.example.com/posts/threshold-comment/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "follow-up",
				},
				options: {
					notifyOnReply: false,
				},
			},
		};

		const second = await fixture.app.inject(requestBase);
		expect(second.statusCode).toBe(200);

		const third = await fixture.app.inject(requestBase);
		expect(third.statusCode).toBe(400);
		expect(third.json()).toMatchObject({
			error: {
				code: "COMMENT_CAPTCHA_REQUIRED",
			},
		});
	});

	it("auto-blacklists by exact ip after the long-window write threshold is exceeded", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
			abuseGuardEnabled: true,
			abuseGuardWindowSec: 600,
			abuseGuardMaxWriteActions: 2,
			autoBlacklistEnabled: true,
			autoBlacklistScope: "post",
			autoBlacklistTtlSec: 1800,
		});
		await seedActivePage(fixture, "post:auto-blacklist");

		const makePayload = (suffix: string) => ({
			siteKey: "fangyuan",
			pageKey: "post:auto-blacklist",
			pageTitle: "Auto Blacklist",
			pageUrl: "https://fangyuan.example.com/posts/auto-blacklist/",
			parentCommentId: null,
			author: {
				name: "Alice",
				email: "alice@example.com",
			},
			content: {
				raw: `comment-${suffix}`,
			},
			options: {
				notifyOnReply: false,
			},
		});

		expect(
			(
				await fixture.app.inject({
					method: "POST",
					url: "/qingyan/api/comments",
					headers: refererFor("post:auto-blacklist"),
					payload: makePayload("1"),
				})
			).statusCode,
		).toBe(200);
		expect(
			(
				await fixture.app.inject({
					method: "POST",
					url: "/qingyan/api/comments",
					headers: refererFor("post:auto-blacklist"),
					payload: makePayload("2"),
				})
			).statusCode,
		).toBe(200);
		expect(
			(
				await fixture.app.inject({
					method: "POST",
					url: "/qingyan/api/comments",
					headers: refererFor("post:auto-blacklist"),
					payload: makePayload("3"),
				})
			).statusCode,
		).toBe(200);

		const blocked = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: refererFor("post:auto-blacklist"),
			payload: makePayload("4"),
		});

		expect(blocked.statusCode).toBe(403);
		expect(blocked.json()).toMatchObject({
			error: {
				code: "COMMENT_BLACKLISTED",
			},
		});
	});
});
