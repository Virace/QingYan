import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	captchaSessions,
	comments,
	pageThreads,
	runtimeSettings,
} from "../../src/db/schema";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("POST /api/comments", () => {
	it("requires captcha before allowing comment creation", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(runtimeSettings).set({
			captchaMode: "always",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
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
		await fixture.app.db.update(runtimeSettings).set({
			captchaMode: "always",
		});

		const blocked = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
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
			url: "/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:create-comment",
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
			url: "/api/comments",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
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
				message: "评论已提交，等待审核。",
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
		expect(thread?.pageUrl).toBe("/posts/create-comment/");
	});

	it("accepts path-only pageUrl input and stores the normalized path", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(runtimeSettings).set({
			captchaMode: "never",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
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
		expect(thread?.pageUrl).toBe("/posts/path-only-comment/");
	});

	it("stores request ip and user agent without exposing them in the public response", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.server.trustProxy = true;
			},
		});
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(runtimeSettings).set({
			captchaMode: "never",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
			headers: {
				"user-agent": "Mozilla/5.0 metadata-test",
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
		expect(comment?.authorIp).toBe("203.0.113.8");
		expect(comment?.authorUserAgent).toBe("Mozilla/5.0 metadata-test");
		expect(comment?.authorDeviceSource).toBe("ua-parser-js");
		expect(comment?.authorDeviceError).toBeNull();
		const publicBody = JSON.stringify(response.json());
		expect(publicBody).not.toContain("203.0.113.8");
		expect(publicBody).not.toContain("Mozilla/5.0 metadata-test");
	});

	it("honors raw request metadata collection switches", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.server.trustProxy = true;
				const metadata = config.sites[0]?.defaults.comments.metadata;
				if (!metadata) {
					throw new Error("Expected metadata config to exist");
				}
				metadata.collectIp = false;
				metadata.collectUserAgent = false;
			},
		});
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(runtimeSettings).set({
			captchaMode: "never",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
			headers: {
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
		expect(comment?.authorIp).toBeNull();
		expect(comment?.authorUserAgent).toBeNull();
		expect(comment?.authorDeviceSource).toBeNull();
	});

	it("keeps comment creation available when ip region database is missing", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.server.trustProxy = true;
				const metadata = config.sites[0]?.defaults.comments.metadata;
				if (!metadata) {
					throw new Error("Expected metadata config to exist");
				}
				metadata.ipRegion.enabled = true;
				metadata.ipRegion.ipv4.dbPath = "./data/missing-ip2region-v4.xdb";
			},
		});
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(runtimeSettings).set({
			captchaMode: "never",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
			headers: {
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
		expect(comment?.authorIp).toBe("203.0.113.10");
		expect(comment?.authorIpLocationError).toBe("xdb_not_found");
		expect(comment?.authorIpCountry).toBeNull();
	});

	it("requires captcha on the third write attempt in threshold mode", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(runtimeSettings).set({
			captchaMode: "threshold",
			captchaThresholdWindowSec: 60,
			captchaThresholdMaxActions: 3,
		});

		const first = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
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
			url: "/api/comments",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
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
		await fixture.app.db.update(runtimeSettings).set({
			captchaMode: "never",
			abuseGuardEnabled: true,
			abuseGuardWindowSec: 600,
			abuseGuardMaxWriteActions: 2,
			autoBlacklistEnabled: true,
			autoBlacklistScope: "post",
			autoBlacklistTtlSec: 1800,
		});

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
					url: "/api/comments",
					payload: makePayload("1"),
				})
			).statusCode,
		).toBe(200);
		expect(
			(
				await fixture.app.inject({
					method: "POST",
					url: "/api/comments",
					payload: makePayload("2"),
				})
			).statusCode,
		).toBe(200);
		expect(
			(
				await fixture.app.inject({
					method: "POST",
					url: "/api/comments",
					payload: makePayload("3"),
				})
			).statusCode,
		).toBe(200);

		const blocked = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
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
