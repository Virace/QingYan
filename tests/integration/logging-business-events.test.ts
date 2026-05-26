import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { captchaSessions, siteSettings } from "../../src/db/schema";
import { formatLogDateKey } from "../../src/logging/file-sink";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import {
	getForcedTestCaptchaAnswer,
	withForcedTestCaptchaAnswer,
} from "../support/captcha";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

function currentLocalDateKey(): string {
	return formatLogDateKey(new Date().toISOString());
}

function readAppJsonl(logsDirectory: string): string {
	const today = currentLocalDateKey();
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
		await withForcedTestCaptchaAnswer(async () => {
			const fixture = await createTestApp();
			cleanups.push(fixture.cleanup);

			const forcedAnswer = getForcedTestCaptchaAnswer();
			for (let index = 1; index <= 5; index += 1) {
				const captchaResponse = await fixture.app.inject({
					method: "GET",
					url: "/qingyan/api/admin/session/captcha",
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

				const loginResponse = await fixture.app.inject({
					method: "POST",
					url: "/qingyan/api/admin/session/login",
					headers: {
						"x-request-id": `req_admin_${index}`,
					},
					payload: {
						username: "admin",
						password: "wrong-password",
						challengeId: challenge.challengeId,
						captchaValue: forcedAnswer,
					},
				});

				expect(loginResponse.statusCode).toBe(index === 5 ? 403 : 401);
			}

			const appJsonl = readAppJsonl(fixture.logsDirectory);
			expect(appJsonl).toContain('"event":"admin.login.failed"');
			expect(appJsonl).toContain('"event":"security.blacklist.added"');
			expect(appJsonl).not.toContain("wrong-token");
			expect(appJsonl).not.toContain(forcedAnswer);
		});
	});

	it("writes captcha.failed, comments.created and settings.updated with request ids", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		await fixture.app.db.update(siteSettings).set({
			captchaMode: "always",
		});

		const captchaState = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:logging-events",
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
			url: "/qingyan/api/comments/captcha/verify",
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
			publicChallenge: {
				imageData: string;
			};
		};

		const validVerify = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments/captcha/verify",
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
			url: "/qingyan/api/comments",
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

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const updateSettings = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			headers: {
				"x-request-id": "req_settings_updated",
				...withAdminWriteAuth({ adminCookie, csrfToken }).headers,
			},
			cookies: withAdminWriteAuth({ adminCookie, csrfToken }).cookies,
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

	it("writes admin csrf rejection logs with diagnostic context", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const invalidCsrf = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			headers: {
				"x-request-id": "req_csrf_invalid",
				origin: "http://localhost:4401",
				"x-qingyan-csrf-token": "csrf_invalid_probe",
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

		expect(invalidCsrf.statusCode).toBe(403);

		const appJsonl = readAppJsonl(fixture.logsDirectory);
		expect(appJsonl).toContain('"event":"admin.csrf.rejected"');
		expect(appJsonl).toContain('"requestId":"req_csrf_invalid"');
		expect(appJsonl).toContain('"reason":"invalid"');
		expect(appJsonl).toContain('"adminRecordFound":true');
		expect(appJsonl).not.toContain("csrf_invalid_probe");
		expect(appJsonl).not.toContain(adminCookie.value);
	});

	it("writes wordpress analyze lifecycle logs when analysis fails", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const analyze = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/wordpress/analyze?siteKey=fangyuan&fileName=bad.xml&sourceBasePath=%2F&pageKeyStrategy=path_without_leading_slash",
			headers: {
				"x-request-id": "req_wp_analyze_failed",
				"content-type": "text/xml",
				...withAdminWriteAuth({ adminCookie, csrfToken }).headers,
			},
			cookies: withAdminWriteAuth({ adminCookie, csrfToken }).cookies,
			payload: "<not-wordpress />",
		});

		expect(analyze.statusCode).toBe(400);

		const appJsonl = readAppJsonl(fixture.logsDirectory);
		expect(appJsonl).toContain('"event":"import.wordpress.analyze.started"');
		expect(appJsonl).toContain('"event":"import.wordpress.analyze.failed"');
		expect(appJsonl).toContain('"requestId":"req_wp_analyze_failed"');
		expect(appJsonl).toContain('"source":"xml_body"');
		expect(appJsonl).toContain('"fileName":"bad.xml"');
		expect(appJsonl).not.toContain("<not-wordpress");
	});
});
