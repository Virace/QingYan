import { afterEach, describe, expect, it } from "vitest";

import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin settings", () => {
	it("reads and updates runtime settings", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const login = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/session/login",
			payload: {
				token: "replace-me",
			},
		});
		const adminCookie = login.cookies.find(
			(cookie) => cookie.name === "qingyan_admin",
		);

		const getResponse = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/settings?siteKey=fangyuan",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(getResponse.statusCode).toBe(200);
		expect(getResponse.json()).toMatchObject({
			siteKey: "fangyuan",
			comments: {
				enabled: true,
				defaultStatus: "pending",
				captcha: {
					mode: "threshold",
					thresholdWindowSec: 60,
					thresholdMaxActions: 3,
				},
				abuseGuard: {
					enabled: true,
					windowSec: 600,
					maxWriteActions: 100,
					autoBlacklist: {
						enabled: true,
						scope: "post",
						ttlSec: 1800,
					},
				},
			},
		});

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/api/admin/settings?siteKey=fangyuan",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
			payload: {
				comments: {
					defaultStatus: "approved",
					captcha: {
						mode: "always",
						thresholdWindowSec: 120,
						thresholdMaxActions: 4,
					},
					abuseGuard: {
						enabled: true,
						windowSec: 900,
						maxWriteActions: 120,
						autoBlacklist: {
							enabled: true,
							scope: "all",
							ttlSec: 2400,
						},
					},
				},
				pageFeedback: {
					allowLike: false,
				},
				notifications: {
					emailEnabled: true,
				},
			},
		});
		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json()).toMatchObject({
			comments: {
				defaultStatus: "approved",
				captcha: {
					mode: "always",
					thresholdWindowSec: 120,
					thresholdMaxActions: 4,
				},
				abuseGuard: {
					enabled: true,
					windowSec: 900,
					maxWriteActions: 120,
					autoBlacklist: {
						enabled: true,
						scope: "all",
						ttlSec: 2400,
					},
				},
			},
			pageFeedback: {
				allowLike: false,
			},
			notifications: {
				emailEnabled: true,
			},
		});
	});
});
