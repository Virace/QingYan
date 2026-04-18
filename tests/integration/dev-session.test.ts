import { afterEach, describe, expect, it } from "vitest";

import { sites } from "../../src/db/schema";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("dev session bootstrap", () => {
	it("returns 404 when dev mode is disabled", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/dev/session",
			payload: {
				token: "dev-token",
			},
		});

		expect(response.statusCode).toBe(404);
	});

	it("creates a normal admin session from dev token in dev mode", async () => {
		const fixture = await createTestApp({
			devMode: true,
			devAdminToken: "dev-token",
		});
		cleanups.push(fixture.cleanup);

		const login = await fixture.app.inject({
			method: "POST",
			url: "/api/dev/session",
			payload: {
				token: "dev-token",
			},
		});

		expect(login.statusCode).toBe(200);
		expect(
			login.cookies.some((cookie) => cookie.name === "qingyan_admin"),
		).toBe(true);
		const adminCookie = login.cookies.find(
			(cookie) => cookie.name === "qingyan_admin",
		);

		const me = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/session/me",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(me.statusCode).toBe(200);
		expect(me.json()).toMatchObject({
			authenticated: true,
			sites: [{ siteKey: "default", name: "Default" }],
		});
	});

	it("filters stale database sites from admin session me in dev mode", async () => {
		const fixture = await createTestApp({
			devMode: true,
			devAdminToken: "dev-token",
		});
		cleanups.push(fixture.cleanup);

		await fixture.app.db.insert(sites).values({
			siteKey: "fangyuan",
			name: "FangYuan",
			allowedOriginsJson: JSON.stringify(["http://localhost:4321"]),
		});

		const login = await fixture.app.inject({
			method: "POST",
			url: "/api/dev/session",
			payload: {
				token: "dev-token",
			},
		});
		const adminCookie = login.cookies.find(
			(cookie) => cookie.name === "qingyan_admin",
		);

		const me = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/session/me",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(me.statusCode).toBe(200);
		expect(me.json().sites).toEqual([{ siteKey: "default", name: "Default" }]);
	});
});
