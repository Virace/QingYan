import { afterEach, describe, expect, it } from "vitest";

import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin ui", () => {
	it("serves the admin shell at /admin", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/admin",
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toContain("text/html");
		expect(response.body).toContain("QingYan Admin");
		expect(
			response.body.includes('id="root"') ||
				response.body.includes('id="admin-root"'),
		).toBe(true);
		expect(response.body).toContain("window.__QINGYAN_ADMIN__");
		expect(response.body).toContain('"basePath":"/admin"');
	});

	it("serves built admin assets when build output exists", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const shell = await fixture.app.inject({
			method: "GET",
			url: "/admin",
		});
		const assetMatch = shell.body.match(/src="\.\/assets\/([^"]+\.js)"/);
		if (!assetMatch?.[1]) {
			expect(shell.body).toContain('id="admin-root"');
			return;
		}

		const response = await fixture.app.inject({
			method: "GET",
			url: `/admin/assets/${assetMatch[1]}`,
		});
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toContain("text/javascript");
	});

	it("rejects admin asset path traversal", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/admin/assets/%2e%2e%2findex.html",
		});

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({
			error: {
				code: "ADMIN_ASSET_NOT_FOUND",
			},
		});
	});

	it("serves deep admin routes from the configured console path", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.admin.console.path = "/qy-console";
			},
		});
		cleanups.push(fixture.cleanup);

		const oldRoute = await fixture.app.inject({
			method: "GET",
			url: "/admin",
		});
		expect(oldRoute.statusCode).toBe(404);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qy-console/comments",
		});
		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("QingYan Admin");
		expect(response.body).toContain('"basePath":"/qy-console"');
	});
});
