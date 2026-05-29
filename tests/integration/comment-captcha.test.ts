import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
	captchaSessions,
	pageThreads,
	sitePageRegistry,
	siteSettings,
	sites,
} from "../../src/db/schema";
import { decodeSvgDataUrl } from "../support/captcha";
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

describe("comment captcha", () => {
	it("rejects captcha state for ignored registry pages without creating a page thread", async () => {
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
			pageKey: "posts/ignored-captcha/",
			pageUrl: "/posts/ignored-captcha/",
			status: "ignored",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/captcha/state?siteKey=fangyuan&pageKey=posts%2Fignored-captcha%2F",
			headers: refererFor("posts/ignored-captcha/"),
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "PAGE_NOT_INTERACTIVE",
			},
		});
		expect(await fixture.app.db.select().from(pageThreads)).toEqual([]);
	});

	it("returns an idle state in threshold mode before the page threshold is hit", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedActivePage(fixture, "post:threshold-idle");

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:threshold-idle",
			headers: refererFor("post:threshold-idle"),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			required: false,
			verified: false,
			mode: "inline_value",
			challenge: null,
		});
	});

	it("creates a challenge, rejects invalid values and accepts the right answer", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "always",
		});
		await seedActivePage(fixture, "post:captcha");

		const stateResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:captcha",
			headers: {
				...refererFor("post:captcha"),
				"user-agent": "captcha-test",
			},
		});

		expect(stateResponse.statusCode).toBe(200);
		expect(
			stateResponse.cookies.some((cookie) => cookie.name === "qingyan_visitor"),
		).toBe(true);
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
		const invalidResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/captcha/verify",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: refererFor("post:captcha"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:captcha",
				challengeId,
				mode: "inline_value",
				value: "0000",
			},
		});
		expect(invalidResponse.statusCode).toBe(400);
		expect(invalidResponse.json()).toMatchObject({
			error: {
				code: "COMMENT_CAPTCHA_INVALID",
			},
		});

		const verifiedResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/captcha/verify",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: refererFor("post:captcha"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:captcha",
				challengeId,
				mode: "inline_value",
				value: payload.answer,
			},
		});
		expect(verifiedResponse.statusCode).toBe(200);
		expect(verifiedResponse.json()).toEqual({
			required: true,
			verified: true,
		});
	});

	it("refreshes an unresolved challenge and does not expose the plaintext answer in svg payload", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "always",
		});
		await seedActivePage(fixture, "post:captcha-refresh");

		const initialState = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:captcha-refresh",
			headers: refererFor("post:captcha-refresh"),
		});
		expect(initialState.statusCode).toBe(200);

		const visitorCookie = initialState.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const initialChallenge = initialState.json().challenge as {
			challengeId: string;
			imageData: string;
		};
		const [initialSession] = await fixture.app.db
			.select()
			.from(captchaSessions)
			.where(eq(captchaSessions.id, initialChallenge.challengeId));
		if (!initialSession) {
			throw new Error("Expected initial captcha session to exist");
		}
		const initialPayload = JSON.parse(
			initialSession.challengePayloadJson ?? "{}",
		) as {
			answer: string;
			publicChallenge: {
				imageData: string;
			};
		};
		expect(decodeSvgDataUrl(initialChallenge.imageData)).not.toContain(
			initialPayload.answer,
		);

		const repeatedState = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:captcha-refresh",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: refererFor("post:captcha-refresh"),
		});
		expect(repeatedState.statusCode).toBe(200);
		expect(repeatedState.json().challenge).toEqual(initialChallenge);

		const refreshedState = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/captcha/refresh",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: refererFor("post:captcha-refresh"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:captcha-refresh",
			},
		});
		expect(refreshedState.statusCode).toBe(200);

		const refreshedChallenge = refreshedState.json().challenge as {
			challengeId: string;
			imageData: string;
		};
		expect(refreshedChallenge.challengeId).not.toBe(
			initialChallenge.challengeId,
		);
		expect(refreshedChallenge.imageData).not.toBe(initialChallenge.imageData);

		const [refreshedSession] = await fixture.app.db
			.select()
			.from(captchaSessions)
			.where(eq(captchaSessions.id, refreshedChallenge.challengeId));
		if (!refreshedSession) {
			throw new Error("Expected refreshed captcha session to exist");
		}
		const refreshedPayload = JSON.parse(
			refreshedSession.challengePayloadJson ?? "{}",
		) as {
			answer: string;
			publicChallenge: {
				imageData: string;
			};
		};
		expect(decodeSvgDataUrl(refreshedChallenge.imageData)).not.toContain(
			refreshedPayload.answer,
		);

		const staleVerify = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/captcha/verify",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: refererFor("post:captcha-refresh"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:captcha-refresh",
				challengeId: initialChallenge.challengeId,
				mode: "inline_value",
				value: initialPayload.answer,
			},
		});
		expect(staleVerify.statusCode).toBe(400);
		expect(staleVerify.json()).toMatchObject({
			error: {
				code: "COMMENT_CAPTCHA_REQUIRED",
			},
		});

		const refreshedVerify = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/captcha/verify",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: refererFor("post:captcha-refresh"),
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:captcha-refresh",
				challengeId: refreshedChallenge.challengeId,
				mode: "inline_value",
				value: refreshedPayload.answer,
			},
		});
		expect(refreshedVerify.statusCode).toBe(200);
		expect(refreshedVerify.json()).toEqual({
			required: true,
			verified: true,
		});
	});
});
