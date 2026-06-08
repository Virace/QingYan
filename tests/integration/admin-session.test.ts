import { afterEach, describe, expect, it } from "vitest";

import { blacklistRules } from "../../src/db/schema";
import { AdminSystemSettingsRepository } from "../../src/modules/admin/system-settings-repository";
import {
	decodeSvgDataUrl,
	getForcedTestCaptchaAnswer,
	withForcedTestCaptchaAnswer,
} from "../support/captcha";
import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin session", () => {
	it("uses the database system setting for new session expiry", async () => {
		await withForcedTestCaptchaAnswer(async () => {
			const fixture = await createTestApp();
			cleanups.push(fixture.cleanup);

			await new AdminSystemSettingsRepository(fixture.app.db).upsert(
				"admin",
				"session.ttlMinutes",
				10080,
			);

			const captchaResponse = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/api/admin/session/captcha",
			});
			const { challenge } = captchaResponse.json() as {
				challenge: {
					challengeId: string;
				};
			};

			const beforeLogin = Date.now();
			const loginResponse = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/admin/session/login",
				payload: {
					username: "admin",
					password: "replace-me",
					challengeId: challenge.challengeId,
					captchaValue: getForcedTestCaptchaAnswer(),
				},
			});
			const afterLogin = Date.now();

			expect(loginResponse.statusCode).toBe(200);
			const adminCookie = loginResponse.cookies.find(
				(cookie) => cookie.name === "qingyan_admin",
			);
			expect(adminCookie?.maxAge).toBe(604_800);

			const expiresAt = new Date(
				(loginResponse.json() as { session: { expiresAt: string } }).session
					.expiresAt,
			).getTime();
			expect(expiresAt).toBeGreaterThanOrEqual(
				beforeLogin + 10080 * 60 * 1000 - 1000,
			);
			expect(expiresAt).toBeLessThanOrEqual(
				afterLogin + 10080 * 60 * 1000 + 1000,
			);
		});
	});

	it("returns csrf token on login and me", async () => {
		await withForcedTestCaptchaAnswer(async () => {
			const fixture = await createTestApp();
			cleanups.push(fixture.cleanup);

			const captchaResponse = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/api/admin/session/captcha",
			});
			const { challenge } = captchaResponse.json() as {
				challenge: {
					challengeId: string;
				};
			};

			const loginResponse = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/admin/session/login",
				payload: {
					username: "admin",
					password: "replace-me",
					challengeId: challenge.challengeId,
					captchaValue: getForcedTestCaptchaAnswer(),
				},
			});

			expect(loginResponse.statusCode).toBe(200);
			expect(loginResponse.json()).toMatchObject({
				authenticated: true,
				csrf: {
					header: "x-qingyan-csrf-token",
				},
			});

			const adminCookie = loginResponse.cookies.find(
				(cookie) => cookie.name === "qingyan_admin",
			);
			const meResponse = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/api/admin/session/me",
				cookies: {
					qingyan_admin: adminCookie?.value ?? "",
				},
			});
			expect(meResponse.statusCode).toBe(200);
			expect(meResponse.json()).toMatchObject({
				authenticated: true,
				csrf: {
					header: "x-qingyan-csrf-token",
				},
			});
		});
	});

	it("requires captcha before allowing admin login", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/session/login",
			payload: {
				username: "admin",
				password: "replace-me",
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "ADMIN_CAPTCHA_REQUIRED",
			},
		});
	});

	it("temporarily blacklists an ip after configured invalid password submissions", async () => {
		await withForcedTestCaptchaAnswer(async () => {
			const fixture = await createTestApp();
			cleanups.push(fixture.cleanup);

			for (let index = 1; index <= 5; index += 1) {
				const captchaResponse = await fixture.app.inject({
					method: "GET",
					url: "/qingyan/api/admin/session/captcha",
				});
				expect(captchaResponse.statusCode).toBe(200);

				const { challenge } = captchaResponse.json() as {
					challenge: {
						challengeId: string;
						imageData: string;
					};
				};
				expect(decodeSvgDataUrl(challenge.imageData)).not.toContain(
					getForcedTestCaptchaAnswer(),
				);

				const response = await fixture.app.inject({
					method: "POST",
					url: "/qingyan/api/admin/session/login",
					payload: {
						username: "admin",
						password: "wrong-password",
						challengeId: challenge.challengeId,
						captchaValue: getForcedTestCaptchaAnswer(),
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
			});
			expect(rules[0]?.expiresAt).toBeTruthy();

			const captchaResponse = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/api/admin/session/captcha",
			});
			expect(captchaResponse.statusCode).toBe(403);
			expect(captchaResponse.json()).toMatchObject({
				error: {
					code: "ADMIN_BLACKLISTED",
				},
			});
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
			url: "/qingyan/api/admin/session/captcha",
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "ADMIN_BLACKLISTED",
			},
		});
	});

	it("logs in, returns me, logs out and invalidates the session", async () => {
		await withForcedTestCaptchaAnswer(async () => {
			const fixture = await createTestApp();
			cleanups.push(fixture.cleanup);

			const invalidCaptcha = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/api/admin/session/captcha",
			});
			const invalidChallenge = invalidCaptcha.json() as {
				challenge: {
					challengeId: string;
					imageData: string;
				};
			};
			expect(
				decodeSvgDataUrl(invalidChallenge.challenge.imageData),
			).not.toContain(getForcedTestCaptchaAnswer());

			const invalidLogin = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/admin/session/login",
				payload: {
					username: "admin",
					password: "wrong-password",
					challengeId: invalidChallenge.challenge.challengeId,
					captchaValue: getForcedTestCaptchaAnswer(),
				},
			});
			expect(invalidLogin.statusCode).toBe(401);
			expect(invalidLogin.json()).toMatchObject({
				error: {
					code: "ADMIN_CREDENTIALS_INVALID",
				},
			});

			const captchaResponse = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/api/admin/session/captcha",
			});
			expect(captchaResponse.statusCode).toBe(200);
			const challenge = captchaResponse.json() as {
				challenge: {
					challengeId: string;
					imageData: string;
				};
			};
			expect(decodeSvgDataUrl(challenge.challenge.imageData)).not.toContain(
				getForcedTestCaptchaAnswer(),
			);

			const loginResponse = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/admin/session/login",
				payload: {
					username: "admin",
					password: "replace-me",
					challengeId: challenge.challenge.challengeId,
					captchaValue: getForcedTestCaptchaAnswer(),
				},
			});
			expect(loginResponse.statusCode).toBe(200);
			expect(
				loginResponse.cookies.some((cookie) => cookie.name === "qingyan_admin"),
			).toBe(true);
			const adminCookie = loginResponse.cookies.find(
				(cookie) => cookie.name === "qingyan_admin",
			);
			const csrfToken = (
				loginResponse.json() as {
					csrf?: {
						token?: string;
					};
				}
			).csrf?.token;
			expect(adminCookie?.maxAge).toBe(259_200);
			expect(csrfToken).toBeTruthy();

			const meResponse = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/api/admin/session/me",
				cookies: {
					qingyan_admin: adminCookie?.value ?? "",
				},
			});
			expect(meResponse.statusCode).toBe(200);
			expect(meResponse.json()).toMatchObject({
				authenticated: true,
				sites: [{ siteKey: "fangyuan", name: "FangYuan" }],
			});
			const meCsrfToken = (
				meResponse.json() as {
					csrf?: {
						token?: string;
					};
				}
			).csrf?.token;
			expect(meCsrfToken).toBeTruthy();

			const logoutResponse = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/admin/session/logout",
				cookies: {
					qingyan_admin: adminCookie?.value ?? "",
				},
				headers: {
					origin: "http://localhost:4401",
					"x-qingyan-csrf-token": meCsrfToken ?? "",
				},
			});
			expect(logoutResponse.statusCode).toBe(200);
			expect(logoutResponse.json()).toEqual({
				authenticated: false,
			});

			const meAfterLogout = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/api/admin/session/me",
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

	it("rejects admin write requests without csrf token", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const response = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/sites/fangyuan",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			headers: {
				origin: "http://localhost:4401",
			},
			payload: {
				name: "Blocked",
			},
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "ADMIN_CSRF_REQUIRED",
			},
		});
	});

	it("uses the fixed dev password for admin login in dev mode", async () => {
		await withForcedTestCaptchaAnswer(async () => {
			const fixture = await createTestApp({
				devMode: true,
				mutateConfig(config) {
					config.admin.auth.username = undefined;
					config.admin.auth.passwordHash = undefined;
				},
			});
			cleanups.push(fixture.cleanup);

			const captchaResponse = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/api/admin/session/captcha",
			});
			expect(captchaResponse.statusCode).toBe(200);
			const challenge = captchaResponse.json() as {
				challenge: {
					challengeId: string;
				};
			};

			const loginResponse = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/admin/session/login",
				payload: {
					username: "admin",
					password: "admin",
					challengeId: challenge.challenge.challengeId,
					captchaValue: getForcedTestCaptchaAnswer(),
				},
			});

			expect(loginResponse.statusCode).toBe(200);
			expect(
				loginResponse.cookies.some((cookie) => cookie.name === "qingyan_admin"),
			).toBe(true);
		});
	});
});
