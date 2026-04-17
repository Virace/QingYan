import { afterEach, describe, expect, it } from "vitest";

import { loginAsAdmin } from "../support/admin-login";
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

		const { adminCookie } = await loginAsAdmin(fixture.app);

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
				identity: {
					allow: ["nickname", "email", "website"],
					require: ["nickname", "email"],
				},
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
					identity: {
						require: ["nickname"],
					},
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
				identity: {
					allow: ["nickname", "email", "website"],
					require: ["nickname"],
				},
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
