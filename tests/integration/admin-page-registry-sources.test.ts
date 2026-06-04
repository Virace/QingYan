import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { taskRuns } from "../../src/db/schema";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin page registry sources", () => {
	it("creates, lists, and refreshes page registry sources", async () => {
		const fixture = await createTestApp({
			pageSourceFetchText: async () =>
				"<urlset><url><loc>http://localhost:4321/posts/from-sitemap/</loc></url></urlset>",
		});
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);

		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/page-registry/sources",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
				sourceType: "sitemap",
				sourceUrl: "http://localhost:4321/sitemap.xml",
				enabled: true,
				mode: "append",
			},
		});

		expect(createResponse.statusCode).toBe(200);
		expect(createResponse.json()).toMatchObject({
			source: {
				siteKey: "fangyuan",
				sourceType: "sitemap",
				sourceUrl: "http://localhost:4321/sitemap.xml",
				enabled: true,
				mode: "append",
			},
		});
		const sourceId = createResponse.json().source.id as number;

		const listResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/page-registry/sources?siteKey=fangyuan",
			cookies: {
				qingyan_admin: admin.adminCookie.value,
			},
		});

		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.json()).toMatchObject({
			items: [
				{
					id: sourceId,
					siteKey: "fangyuan",
					sourceType: "sitemap",
					sourceUrl: "http://localhost:4321/sitemap.xml",
				},
			],
		});

		const refreshResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/page-registry/sources/${sourceId}/refresh`,
			...withAdminWriteAuth(admin),
		});

		expect(refreshResponse.statusCode).toBe(200);
		expect(refreshResponse.json()).toMatchObject({
			run: {
				type: "page_source_refresh",
				status: "queued",
				siteKey: "fangyuan",
				input: {
					siteKey: "fangyuan",
					sourceIds: [sourceId],
					trigger: "manual",
				},
			},
		});
		const [run] = await fixture.app.db
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.type, "page_source_refresh"));
		expect(run).toMatchObject({
			status: "queued",
			siteKey: "fangyuan",
		});
	});

	it("rejects cross-origin source URLs", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/page-registry/sources",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
				sourceType: "sitemap",
				sourceUrl: "https://other.example.com/sitemap.xml",
				enabled: true,
				mode: "append",
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "PAGE_SOURCE_ORIGIN_NOT_ALLOWED",
			},
		});
	});

	it("requires CSRF tokens on source create and refresh", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);

		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/page-registry/sources",
			cookies: {
				qingyan_admin: admin.adminCookie.value,
			},
			payload: {
				siteKey: "fangyuan",
				sourceType: "sitemap",
				sourceUrl: "http://localhost:4321/sitemap.xml",
				enabled: true,
				mode: "append",
			},
		});

		expect(createResponse.statusCode).toBe(403);

		const sourceResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/page-registry/sources",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
				sourceType: "sitemap",
				sourceUrl: "http://localhost:4321/sitemap.xml",
				enabled: true,
				mode: "append",
			},
		});
		const sourceId = sourceResponse.json().source.id as number;

		const refreshResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/page-registry/sources/${sourceId}/refresh`,
			cookies: {
				qingyan_admin: admin.adminCookie.value,
			},
		});

		expect(refreshResponse.statusCode).toBe(403);
	});

	it("deletes page registry sources with CSRF protection", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);

		const sourceResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/page-registry/sources",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
				sourceType: "sitemap",
				sourceUrl: "http://localhost:4321/sitemap.xml",
				enabled: true,
				mode: "append",
			},
		});
		const sourceId = sourceResponse.json().source.id as number;

		const forbidden = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/page-registry/sources/${sourceId}`,
			cookies: {
				qingyan_admin: admin.adminCookie.value,
			},
		});
		expect(forbidden.statusCode).toBe(403);

		const deleted = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/page-registry/sources/${sourceId}`,
			...withAdminWriteAuth(admin),
		});
		expect(deleted.statusCode).toBe(200);
		expect(deleted.json()).toEqual({ ok: true });

		const listResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/page-registry/sources?siteKey=fangyuan",
			cookies: {
				qingyan_admin: admin.adminCookie.value,
			},
		});
		expect(listResponse.json()).toMatchObject({ items: [] });
	});

	it("stores execution options on single page source refresh jobs", async () => {
		const fixture = await createTestApp({
			pageSourceFetchText: async () => "<urlset />",
		});
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);

		const sourceResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/page-registry/sources",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
				sourceType: "sitemap",
				sourceUrl: "http://localhost:4321/sitemap.xml",
				enabled: true,
				mode: "append",
			},
		});
		const sourceId = sourceResponse.json().source.id as number;

		const singleResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/page-registry/sources/${sourceId}/refresh`,
			...withAdminWriteAuth(admin),
			payload: {
				timeoutMs: 12_000,
				maxBytes: 1_048_576,
				runAfter: "2099-01-01T00:00:00.000Z",
				maxAttempts: 4,
				retryDelaySec: 120,
			},
		});

		expect(singleResponse.statusCode).toBe(200);
		expect(singleResponse.json().run).toMatchObject({
			status: "delayed",
			runAfter: "2099-01-01T00:00:00.000Z",
			maxAttempts: 4,
			retryDelaySec: 120,
			input: {
				timeoutMs: 12_000,
				maxBytes: 1_048_576,
			},
		});
	});

	it("stores execution options on all page source refresh jobs", async () => {
		const fixture = await createTestApp({
			pageSourceFetchText: async () => "<urlset />",
		});
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);
		const allResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/page-registry/refresh",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
				timeoutMs: 15_000,
				maxBytes: 2_097_152,
				maxAttempts: 3,
				retryDelaySec: 90,
			},
		});

		expect(allResponse.statusCode).toBe(200);
		expect(allResponse.json().run).toMatchObject({
			maxAttempts: 3,
			retryDelaySec: 90,
			input: {
				siteKey: "fangyuan",
				timeoutMs: 15_000,
				maxBytes: 2_097_152,
			},
		});
	});
});
