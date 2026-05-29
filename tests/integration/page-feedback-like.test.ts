import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
	captchaSessions,
	pageFeedbackRecords,
	pageThreads,
	sitePageRegistry,
	siteSettings,
	sites,
} from "../../src/db/schema";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

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

describe("POST /qingyan/api/page-feedback/like", () => {
	it("rejects likes for pages missing from the registry without creating a page thread", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			headers: {
				referer: "http://localhost:4321/posts/unregistered-like/",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "posts/unregistered-like/",
				pageTitle: "Unregistered Like",
				pageUrl: "https://fangyuan.example.com/posts/unregistered-like/",
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

	it("rejects likes for deleted registry pages without creating a page thread", async () => {
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
			pageKey: "posts/deleted-like/",
			pageUrl: "/posts/deleted-like/",
			status: "deleted",
			deletedAt: "2026-05-29T00:00:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			headers: {
				referer: "http://localhost:4321/posts/deleted-like/",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "posts/deleted-like/",
				pageTitle: "Deleted Like",
				pageUrl: "https://fangyuan.example.com/posts/deleted-like/",
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

	it("likes a page once and blocks repeated likes from the same visitor", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedActivePage(fixture, "post:like");

		const firstLike = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			headers: {
				referer: "http://localhost:4321/post:like",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:like",
				pageTitle: "Like Page",
				pageUrl: "https://fangyuan.example.com/posts/like/",
			},
		});

		expect(firstLike.statusCode).toBe(200);
		expect(firstLike.json()).toMatchObject({
			pageFeedback: {
				supportsLike: true,
				likeCount: 1,
				liked: true,
			},
		});

		const visitorCookie = firstLike.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const secondLike = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: {
				referer: "http://localhost:4321/post:like",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:like",
				pageTitle: "Like Page",
				pageUrl: "https://fangyuan.example.com/posts/like/",
			},
		});

		expect(secondLike.statusCode).toBe(409);
		expect(secondLike.json()).toMatchObject({
			error: {
				code: "PAGE_FEEDBACK_ALREADY_LIKED",
			},
		});
	});

	it("creates page threads from Referer when legacy like payload identity is stale", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedActivePage(fixture, "lol_voice_collation.html");

		const firstLike = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			headers: {
				referer: "http://localhost:4321/lol_voice_collation.html",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "lol_voice_collation",
				pageTitle: "Like HTML Page",
				pageUrl: "https://x-item.com/lol_voice_collation.html",
			},
		});

		expect(firstLike.statusCode).toBe(200);

		const threads = await fixture.app.db.select().from(pageThreads);
		expect(threads).toHaveLength(1);
		expect(threads[0]).toMatchObject({
			pageKey: "lol_voice_collation.html",
			pageUrl: "/lol_voice_collation.html",
			pageTitle: "Like HTML Page",
			pageLikeCount: 1,
		});
	});

	it("accepts captcha payload inline when retrying page like", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "always",
		});
		await seedActivePage(fixture, "post:like-threshold");

		const blockedLike = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			headers: {
				referer: "http://localhost:4321/post:like-threshold",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:like-threshold",
				pageTitle: "Like Threshold",
				pageUrl: "https://fangyuan.example.com/posts/like-threshold/",
			},
		});
		expect(blockedLike.statusCode).toBe(400);
		expect(blockedLike.json()).toMatchObject({
			error: {
				code: "PAGE_FEEDBACK_CAPTCHA_REQUIRED",
			},
		});
		const captchaState = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:like-threshold",
			headers: {
				referer: "http://localhost:4321/post:like-threshold",
			},
		});
		expect(captchaState.statusCode).toBe(200);
		const visitorCookie = captchaState.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const cookieValue = visitorCookie?.value ?? "";
		const challengeId = captchaState.json().challenge.challengeId as string;
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

		const like = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			cookies: {
				qingyan_visitor: cookieValue,
			},
			headers: {
				referer: "http://localhost:4321/post:like-threshold",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:like-threshold",
				pageTitle: "Like Threshold",
				pageUrl: "https://fangyuan.example.com/posts/like-threshold/",
				captcha: {
					challengeId,
					value: payload.answer,
				},
			},
		});

		expect(like.statusCode).toBe(200);
		expect(like.json()).toMatchObject({
			pageFeedback: {
				supportsLike: true,
				likeCount: 1,
				liked: true,
			},
		});
	});

	it("uses runtime-only overlay for default site likes in dev mode", async () => {
		const fixture = await createTestApp({
			devMode: true,
			devAdminToken: "dev-token",
		});
		cleanups.push(fixture.cleanup);

		const firstLike = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			payload: {
				siteKey: "default",
				pageKey: "post:dev-like",
				pageTitle: "Dev Like",
				pageUrl: "https://example.test/posts/dev-like",
			},
		});

		expect(firstLike.statusCode).toBe(200);
		expect(firstLike.json()).toMatchObject({
			pageFeedback: {
				supportsLike: true,
				likeCount: 1,
				liked: true,
			},
		});

		const visitorCookie = firstLike.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const secondLike = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "default",
				pageKey: "post:dev-like",
				pageTitle: "Dev Like",
				pageUrl: "https://example.test/posts/dev-like",
			},
		});

		expect(secondLike.statusCode).toBe(409);
		expect(await fixture.app.db.select().from(pageThreads)).toEqual([]);
		expect(await fixture.app.db.select().from(pageFeedbackRecords)).toEqual([]);
	});
});
