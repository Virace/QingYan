import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	captchaSessions,
	comments,
	pageThreads,
	sitePageRegistry,
	siteSettings,
	sites,
} from "../../src/db/schema";
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

describe("POST /qingyan/api/comments/:commentId/vote", () => {
	it("rejects votes for pages missing from the registry without creating a page thread", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/missing_registry_vote/vote",
			headers: refererFor("post:missing-registry-vote"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:missing-registry-vote",
				choice: "up",
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

	it("casts one vote and blocks duplicate votes from the same visitor", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedActivePage(fixture, "post:vote");

		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:vote",
			pageTitle: "Vote Post",
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:vote"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(comments).values({
			id: "c_vote_target",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: null,
			status: "approved",
			authorName: "Alice",
			contentRaw: "vote me",
			contentHtml: "<p>vote me</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-04-17T10:00:00.000Z",
			updatedAt: "2026-04-17T10:00:00.000Z",
		});

		const firstVote = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/c_vote_target/vote",
			headers: refererFor("post:vote"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:vote",
				choice: "up",
			},
		});
		expect(firstVote.statusCode).toBe(200);
		expect(firstVote.json()).toMatchObject({
			commentId: "c_vote_target",
			voteUp: 1,
			voteDown: 0,
			viewerVote: "up",
		});

		const visitorCookie = firstVote.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const duplicateVote = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/c_vote_target/vote",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: refererFor("post:vote"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:vote",
				choice: "up",
			},
		});
		expect(duplicateVote.statusCode).toBe(409);
		expect(duplicateVote.json()).toMatchObject({
			error: {
				code: "VOTE_ALREADY_CAST",
			},
		});
	});

	it("accepts captcha payload inline when retrying comment vote in always mode", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "always",
		});
		await seedActivePage(fixture, "post:vote-captcha");

		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:vote-captcha",
			pageTitle: "Vote Captcha Post",
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:vote-captcha"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(comments).values({
			id: "c_vote_captcha",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: null,
			status: "approved",
			authorName: "Alice",
			contentRaw: "vote me",
			contentHtml: "<p>vote me</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-04-17T10:00:00.000Z",
			updatedAt: "2026-04-17T10:00:00.000Z",
		});

		const blockedVote = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/c_vote_captcha/vote",
			headers: refererFor("post:vote-captcha"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:vote-captcha",
				choice: "up",
			},
		});
		expect(blockedVote.statusCode).toBe(400);
		expect(blockedVote.json()).toMatchObject({
			error: {
				code: "VOTE_CAPTCHA_REQUIRED",
			},
		});

		const stateResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:vote-captcha",
			headers: refererFor("post:vote-captcha"),
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

		const vote = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/c_vote_captcha/vote",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: refererFor("post:vote-captcha"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:vote-captcha",
				choice: "up",
				captcha: {
					challengeId,
					value: payload.answer,
				},
			},
		});

		expect(vote.statusCode).toBe(200);
		expect(vote.json()).toMatchObject({
			commentId: "c_vote_captcha",
			voteUp: 1,
			viewerVote: "up",
		});
	});
});
