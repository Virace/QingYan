import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	captchaSessions,
	comments,
	pageThreads,
	sitePageRegistry,
	siteSettings,
	sites,
	visitors,
	voteRecords,
} from "../../src/db/schema";
import {
	type EngagementSettings,
	serializeEngagementSettings,
} from "../../src/modules/shared/site-settings-defaults";
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

async function updateEngagement(
	fixture: TestFixture,
	engagement: EngagementSettings,
) {
	await fixture.app.db.update(siteSettings).set({
		allowPageLike: engagement.pageLikes.enabled,
		engagementJson: serializeEngagementSettings(engagement),
	});
}

async function enableTrustedCommentVotes(fixture: TestFixture) {
	await updateEngagement(fixture, {
		visitors: { enabled: true },
		pageViews: { enabled: false },
		pageLikes: { enabled: false },
		commentVotes: { enabled: true },
	});
}

async function seedApprovedComment(
	fixture: TestFixture,
	input: {
		pageKey: string;
		commentId: string;
	},
) {
	await seedActivePage(fixture, input.pageKey);
	const [site] = await fixture.app.db
		.select()
		.from(sites)
		.where(eq(sites.siteKey, "fangyuan"));
	if (!site) {
		throw new Error("Expected site to exist");
	}

	await fixture.app.db.insert(pageThreads).values({
		siteId: site.id,
		pageKey: input.pageKey,
		pageTitle: "Vote Post",
	});
	const [thread] = await fixture.app.db
		.select()
		.from(pageThreads)
		.where(eq(pageThreads.pageKey, input.pageKey));
	if (!thread) {
		throw new Error("Expected thread to exist");
	}

	await fixture.app.db.insert(comments).values({
		id: input.commentId,
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
		await enableTrustedCommentVotes(fixture);
		await seedApprovedComment(fixture, {
			pageKey: "post:vote",
			commentId: "c_vote_target",
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
			vote: {
				up: 1,
				down: 0,
				viewer: "up",
			},
		});
		expect(firstVote.json()).not.toHaveProperty("voteUp");
		expect(firstVote.json()).not.toHaveProperty("voteDown");
		expect(firstVote.json()).not.toHaveProperty("viewerVote");
		expect(firstVote.json()).not.toHaveProperty("trustMode");

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
			engagementJson: serializeEngagementSettings({
				visitors: { enabled: true },
				pageViews: { enabled: false },
				pageLikes: { enabled: false },
				commentVotes: { enabled: true },
			}),
		});
		await seedApprovedComment(fixture, {
			pageKey: "post:vote-captcha",
			commentId: "c_vote_captcha",
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
			vote: {
				up: 1,
				viewer: "up",
			},
		});
		expect(vote.json()).not.toHaveProperty("viewerVote");
	});

	it("rejects comment votes when commentVotes is disabled", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await updateEngagement(fixture, {
			visitors: { enabled: true },
			pageViews: { enabled: false },
			pageLikes: { enabled: false },
			commentVotes: { enabled: false },
		});
		await seedApprovedComment(fixture, {
			pageKey: "post:vote-disabled",
			commentId: "c_vote_disabled",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/c_vote_disabled/vote",
			headers: refererFor("post:vote-disabled"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:vote-disabled",
				choice: "up",
			},
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "COMMENT_VOTE_DISABLED",
			},
		});
	});

	it("increments lightweight comment votes without visitor rows or vote records", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await updateEngagement(fixture, {
			visitors: { enabled: false },
			pageViews: { enabled: false },
			pageLikes: { enabled: false },
			commentVotes: { enabled: true },
		});
		await seedApprovedComment(fixture, {
			pageKey: "post:vote-lightweight",
			commentId: "c_vote_lightweight",
		});

		const payload = {
			siteKey: "fangyuan",
			pageKey: "post:vote-lightweight",
			choice: "up",
		};
		const firstVote = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/c_vote_lightweight/vote",
			headers: refererFor("post:vote-lightweight"),
			payload,
		});
		const secondVote = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/c_vote_lightweight/vote",
			headers: refererFor("post:vote-lightweight"),
			payload,
		});

		expect(firstVote.statusCode).toBe(200);
		expect(secondVote.statusCode).toBe(200);
		expect(firstVote.cookies).not.toContainEqual(
			expect.objectContaining({ name: "qingyan_visitor" }),
		);
		expect(secondVote.json()).toMatchObject({
			commentId: "c_vote_lightweight",
			vote: {
				up: 2,
				down: 0,
				viewer: "up",
			},
		});
		expect(secondVote.json()).not.toHaveProperty("trustMode");
		expect(await fixture.app.db.select().from(visitors)).toEqual([]);
		expect(await fixture.app.db.select().from(voteRecords)).toEqual([]);
	});
});
