import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { maintenanceJobs, sitePageRegistry } from "../../src/db/schema";
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
			job: {
				type: "page_source_refresh",
				status: "queued",
			},
		});

		const [job] = await fixture.app.db.select().from(maintenanceJobs);
		expect(job).toMatchObject({
			type: "page_source_refresh",
			status: "succeeded",
		});
		const [page] = await fixture.app.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "posts/from-sitemap/"));
		expect(page).toMatchObject({
			pageUrl: "/posts/from-sitemap/",
			status: "active",
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
});
