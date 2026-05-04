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
				metadata: {
					collectIp: true,
					collectUserAgent: true,
					ipRegion: {
						enabled: false,
						cachePolicy: "vectorIndex",
						precision: "province",
						autoUpdate: {
							enabled: false,
							schedule: "monthly",
						},
					},
					device: {
						enabled: true,
						display: {
							enabled: false,
						},
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
					metadata: {
						collectIp: false,
						collectUserAgent: false,
						ipRegion: {
							enabled: true,
							cachePolicy: "file",
							precision: "city",
							autoUpdate: {
								enabled: true,
							},
						},
						device: {
							enabled: false,
							display: {
								enabled: true,
							},
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
				metadata: {
					collectIp: false,
					collectUserAgent: false,
					ipRegion: {
						enabled: true,
						cachePolicy: "file",
						precision: "city",
						autoUpdate: {
							enabled: true,
							schedule: "monthly",
						},
					},
					device: {
						enabled: false,
						display: {
							enabled: true,
						},
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

	it("reads runtime settings for the dev default site", async () => {
		const fixture = await createTestApp({ devMode: true });
		cleanups.push(fixture.cleanup);
		const { adminCookie } = await loginAsAdmin(fixture.app, {
			password: "admin",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/settings?siteKey=default",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			siteKey: "default",
			comments: {
				enabled: true,
				defaultStatus: "pending",
			},
		});
	});

	it("persists runtime settings for the dev default site", async () => {
		const fixture = await createTestApp({ devMode: true });
		cleanups.push(fixture.cleanup);
		const { adminCookie } = await loginAsAdmin(fixture.app, {
			password: "admin",
		});

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/api/admin/settings?siteKey=default",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				comments: {
					enabled: false,
				},
			},
		});
		expect(updateResponse.statusCode).toBe(200);

		const readResponse = await fixture.app.inject({
			method: "GET",
			url: "/api/admin/settings?siteKey=default",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(readResponse.statusCode).toBe(200);
		expect(readResponse.json()).toMatchObject({
			siteKey: "default",
			comments: {
				enabled: false,
			},
		});
	});
});
