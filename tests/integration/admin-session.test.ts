import { afterEach, describe, expect, it } from "vitest";

import { blacklistRules } from "../../src/db/schema";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin session", () => {
	it("rejects login from a blacklisted source with admin-specific error code", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		await fixture.app.db.insert(blacklistRules).values({
			targetType: "ip",
			targetValue: "127.0.0.1",
			source: "manual",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/session/login",
			payload: {
				token: "replace-me",
			},
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

		const invalidLogin = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/session/login",
			payload: {
				token: "wrong-token",
			},
		});
		expect(invalidLogin.statusCode).toBe(401);
		expect(invalidLogin.json()).toMatchObject({
			error: {
				code: "ADMIN_TOKEN_INVALID",
			},
		});

		const loginResponse = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/session/login",
			payload: {
				token: "replace-me",
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
