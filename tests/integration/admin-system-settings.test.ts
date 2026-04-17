import { afterEach, describe, expect, it } from "vitest";

import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin system settings", () => {
	it("reads and updates global logging settings", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);

		const getResponse = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/system-settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(getResponse.statusCode).toBe(200);
		expect(getResponse.json()).toEqual({
			logging: {
				level: "info",
				retentionDays: 7,
				directory: fixture.logsDirectory,
			},
		});

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/api/admin/system-settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				logging: {
					level: "debug",
					retentionDays: 14,
				},
			},
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json()).toEqual({
			logging: {
				level: "debug",
				retentionDays: 14,
				directory: fixture.logsDirectory,
			},
		});
		expect(fixture.app.loggerManager.getRuntimeSettings()).toEqual({
			level: "debug",
			retentionDays: 14,
		});
	});

	it("rejects invalid logging values", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);

		const invalidResponse = await fixture.app.inject({
			method: "PUT",
			url: "/api/admin/system-settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				logging: {
					level: "verbose",
					retentionDays: 0,
				},
			},
		});

		expect(invalidResponse.statusCode).toBe(400);
		expect(invalidResponse.json()).toMatchObject({
			error: {
				code: "INVALID_REQUEST",
			},
		});
	});
});
