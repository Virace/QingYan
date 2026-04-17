import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	captchaSessions,
	comments,
	pageThreads,
	runtimeSettings,
	sites,
} from "../../src/db/schema";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("POST /api/comments/:commentId/vote", () => {
	it("casts one vote and blocks duplicate votes from the same visitor", async () => {
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
			url: "/api/comments/c_vote_target/vote",
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
			url: "/api/comments/c_vote_target/vote",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
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

	it("reuses the same verified page captcha session for comment vote in always mode", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(runtimeSettings).set({
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

		const stateResponse = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:vote-captcha",
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
		};

		await fixture.app.inject({
			method: "POST",
			url: "/api/comments/captcha/verify",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:vote-captcha",
				challengeId,
				mode: "inline_value",
				value: payload.answer,
			},
		});

		const vote = await fixture.app.inject({
			method: "POST",
			url: "/api/comments/c_vote_captcha/vote",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:vote-captcha",
				choice: "up",
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
