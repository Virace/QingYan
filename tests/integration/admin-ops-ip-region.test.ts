import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { taskRuns } from "../../src/db/schema";
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

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			commentMetadata: expect.objectContaining({
				totalWithIp: expect.any(Number),
			}),
			recentJobs: expect.any(Array),
		});

		await fixture.cleanup();
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

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			run: {
				type: "comment_ip_refresh",
				status: "queued",
				siteKey: "fangyuan",
				input: {
					scope: "missing",
					ipVersions: ["v4"],
					siteKey: "fangyuan",
					batchSize: 100,
				},
			},
		});
		const [run] = await fixture.app.db
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.type, "comment_ip_refresh"));
		expect(run).toMatchObject({
			status: "queued",
			siteKey: "fangyuan",
		});

		await fixture.cleanup();
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
