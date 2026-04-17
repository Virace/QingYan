import { afterEach, describe, expect, it } from "vitest";

import { blacklistRules } from "../../src/db/schema";
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

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin session", () => {
	it("requires captcha before allowing admin login", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/session/login",
			payload: {
				token: "replace-me",
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "ADMIN_CAPTCHA_REQUIRED",
			},
		});
	});

	it("permanently blacklists an ip after five invalid token submissions", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		for (let index = 1; index <= 5; index += 1) {
			const captchaResponse = await fixture.app.inject({
				method: "GET",
				url: "/api/admin/session/captcha",
			});
			expect(captchaResponse.statusCode).toBe(200);

			const { challenge } = captchaResponse.json() as {
				challenge: {
					challengeId: string;
					imageData: string;
				};
			};

			const response = await fixture.app.inject({
				method: "POST",
				url: "/api/admin/session/login",
				payload: {
					token: "wrong-token",
					challengeId: challenge.challengeId,
					captchaValue: extractCaptchaAnswer(challenge.imageData),
				},
			});

			expect(response.statusCode).toBe(index === 5 ? 403 : 401);
		}

		const rules = await fixture.app.db.select().from(blacklistRules);
		expect(rules).toHaveLength(1);
		expect(rules[0]).toMatchObject({
			targetType: "ip",
			targetValue: "127.0.0.1",
			source: "auto",
			scope: "all",
			expiresAt: null,
		});

		const captchaResponse = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/session/captcha",
		});
		expect(captchaResponse.statusCode).toBe(403);
		expect(captchaResponse.json()).toMatchObject({
			error: {
				code: "ADMIN_BLACKLISTED",
			},
		});
	});

	it("rejects login from a blacklisted source with admin-specific error code", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		await fixture.app.db.insert(blacklistRules).values({
			targetType: "ip",
			targetValue: "127.0.0.1",
			source: "manual",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/session/captcha",
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "ADMIN_BLACKLISTED",
			},
		});
	});

	it("logs in, returns me, logs out and invalidates the session", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const invalidCaptcha = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/session/captcha",
		});
		const invalidChallenge = invalidCaptcha.json() as {
			challenge: {
				challengeId: string;
				imageData: string;
			};
		};

		const invalidLogin = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/session/login",
			payload: {
				token: "wrong-token",
				challengeId: invalidChallenge.challenge.challengeId,
				captchaValue: extractCaptchaAnswer(
					invalidChallenge.challenge.imageData,
				),
			},
		});
		expect(invalidLogin.statusCode).toBe(401);
		expect(invalidLogin.json()).toMatchObject({
			error: {
				code: "ADMIN_TOKEN_INVALID",
			},
		});

		const captchaResponse = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/session/captcha",
		});
		expect(captchaResponse.statusCode).toBe(200);
		const challenge = captchaResponse.json() as {
			challenge: {
				challengeId: string;
				imageData: string;
			};
		};

		const loginResponse = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/session/login",
			payload: {
				token: "replace-me",
				challengeId: challenge.challenge.challengeId,
				captchaValue: extractCaptchaAnswer(challenge.challenge.imageData),
			},
		});
		expect(loginResponse.statusCode).toBe(200);
		expect(
			loginResponse.cookies.some((cookie) => cookie.name === "qingyan_admin"),
		).toBe(true);
		const adminCookie = loginResponse.cookies.find(
			(cookie) => cookie.name === "qingyan_admin",
		);

		const meResponse = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/session/me",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(meResponse.statusCode).toBe(200);
		expect(meResponse.json()).toMatchObject({
			authenticated: true,
			sites: [{ siteKey: "fangyuan", name: "FangYuan" }],
		});

		const logoutResponse = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/session/logout",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(logoutResponse.statusCode).toBe(200);
		expect(logoutResponse.json()).toEqual({
			authenticated: false,
		});

		const meAfterLogout = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/session/me",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(meAfterLogout.statusCode).toBe(401);
		expect(meAfterLogout.json()).toMatchObject({
			error: {
				code: "ADMIN_AUTH_REQUIRED",
			},
		});
	});
});
