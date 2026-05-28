import { describe, expect, it } from "vitest";

import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

describe("admin ops IP region maintenance", () => {
	it("returns IP region maintenance status", async () => {
		const fixture = await createTestApp();
		const { adminCookie } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/ops/ip-region",
			cookies: { qingyan_admin: adminCookie.value },
		});

		await fixture.cleanup();

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			commentMetadata: expect.objectContaining({
				totalWithIp: expect.any(Number),
			}),
			recentJobs: expect.any(Array),
		});
	});

	it("creates a comment IP refresh job with CSRF", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/comment-ip/refresh",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				scope: "missing",
				ipVersions: ["v4"],
				siteKey: "fangyuan",
				batchSize: 100,
			},
		});

		await fixture.cleanup();

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			job: {
				type: "comment_ip_refresh",
				status: "queued",
			},
		});
	});

	it("rejects comment IP refresh without CSRF", async () => {
		const fixture = await createTestApp();
		const { adminCookie } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/comment-ip/refresh",
			cookies: { qingyan_admin: adminCookie.value },
			payload: {
				scope: "missing",
				ipVersions: ["v4"],
			},
		});

		await fixture.cleanup();

		expect(response.statusCode).toBe(403);
	});
});
