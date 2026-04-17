import { afterEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { captchaSessions, runtimeSettings } from "../../src/db/schema";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("comment captcha", () => {
	it("returns an idle state in threshold mode before the page threshold is hit", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:threshold-idle",
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
		await fixture.app.db.update(runtimeSettings).set({
			captchaMode: "always",
		});

		const stateResponse = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:captcha",
			headers: {
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
		};
		const invalidResponse = await fixture.app.inject({
			method: "POST",
			url: "/api/comments/captcha/verify",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
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
			url: "/api/comments/captcha/verify",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
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
});
