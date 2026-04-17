import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { captchaSessions, runtimeSettings } from "../../src/db/schema";
import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

function extractCaptchaAnswer(imageData: string): string {
	const encoded = imageData.split(",")[1];
	if (!encoded) {
		throw new Error("Expected captcha image data");
	}

	const svg = Buffer.from(encoded, "base64").toString("utf-8");
	const matched = svg.match(/>(\d{4})</);
	if (!matched?.[1]) {
		throw new Error("Expected captcha answer in SVG");
	}

	return matched[1];
}

function readAppJsonl(logsDirectory: string): string {
	const today = new Date().toISOString().slice(0, 10);
	return readFileSync(
		path.join(logsDirectory, "app", `${today}.jsonl`),
		"utf-8",
	);
}

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("logging business events", () => {
	it("writes admin login failure and blacklist add events without leaking secrets", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		let lastCaptchaAnswer = "";
		for (let index = 1; index <= 5; index += 1) {
			const captchaResponse = await fixture.app.inject({
				method: "GET",
				url: "/api/admin/session/captcha",
				headers: {
					"x-request-id": `req_admin_${index}`,
				},
			});
			expect(captchaResponse.statusCode).toBe(200);

			const { challenge } = captchaResponse.json() as {
				challenge: {
					challengeId: string;
					imageData: string;
				};
			};
			lastCaptchaAnswer = extractCaptchaAnswer(challenge.imageData);

			const loginResponse = await fixture.app.inject({
				method: "POST",
				url: "/api/admin/session/login",
				headers: {
					"x-request-id": `req_admin_${index}`,
				},
				payload: {
					token: "wrong-token",
					challengeId: challenge.challengeId,
					captchaValue: lastCaptchaAnswer,
				},
			});

			expect(loginResponse.statusCode).toBe(index === 5 ? 403 : 401);
		}

		const appJsonl = readAppJsonl(fixture.logsDirectory);
		expect(appJsonl).toContain('"event":"admin.login.failed"');
		expect(appJsonl).toContain('"event":"security.blacklist.added"');
		expect(appJsonl).not.toContain("wrong-token");
		expect(appJsonl).not.toContain(lastCaptchaAnswer);
	});

	it("writes captcha.failed, comments.created and settings.updated with request ids", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		await fixture.app.db.update(runtimeSettings).set({
			captchaMode: "always",
		});

		const captchaState = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:logging-events",
			headers: {
				"x-request-id": "req_captcha_state",
			},
		});
		expect(captchaState.statusCode).toBe(200);

		const visitorCookie = captchaState.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const challengeId = captchaState.json().challenge.challengeId as string;

		const invalidVerify = await fixture.app.inject({
			method: "POST",
			url: "/api/comments/captcha/verify",
			headers: {
				"x-request-id": "req_captcha_failed",
			},
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:logging-events",
				challengeId,
				mode: "inline_value",
				value: "0000",
			},
		});
		expect(invalidVerify.statusCode).toBe(400);

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

		const validVerify = await fixture.app.inject({
			method: "POST",
			url: "/api/comments/captcha/verify",
			headers: {
				"x-request-id": "req_captcha_verified",
			},
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:logging-events",
				challengeId,
				mode: "inline_value",
				value: payload.answer,
			},
		});
		expect(validVerify.statusCode).toBe(200);

		const createComment = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
			headers: {
				"x-request-id": "req_comment_created",
			},
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:logging-events",
				pageTitle: "Logging Events",
				pageUrl: "https://fangyuan.example.com/posts/logging-events/",
				parentCommentId: null,
				author: {
					name: "Alice",
					email: "alice@example.com",
				},
				content: {
					raw: "hello qingyan logging",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});
		expect(createComment.statusCode).toBe(200);

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const updateSettings = await fixture.app.inject({
			method: "PUT",
			url: "/api/admin/settings?siteKey=fangyuan",
			headers: {
				"x-request-id": "req_settings_updated",
			},
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				comments: {
					defaultStatus: "approved",
				},
			},
		});
		expect(updateSettings.statusCode).toBe(200);

		const appJsonl = readAppJsonl(fixture.logsDirectory);
		expect(appJsonl).toContain('"event":"captcha.failed"');
		expect(appJsonl).toContain('"requestId":"req_captcha_failed"');
		expect(appJsonl).toContain('"event":"captcha.verified"');
		expect(appJsonl).toContain('"requestId":"req_captcha_verified"');
		expect(appJsonl).toContain('"event":"comments.created"');
		expect(appJsonl).toContain('"requestId":"req_comment_created"');
		expect(appJsonl).toContain('"event":"settings.updated"');
		expect(appJsonl).toContain('"requestId":"req_settings_updated"');
	});
});
