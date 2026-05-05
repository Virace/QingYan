import { afterEach, describe, expect, it } from "vitest";

import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin ui", () => {
	it("redirects the extensionless admin entry to the slash route", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/admin",
		});

		expect(response.statusCode).toBe(302);
		expect(response.headers.location).toBe("/admin/");
	});

	it("serves the admin shell at /admin/", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/admin/",
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
			url: "/admin/",
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

	it("blocks the retired install route under the configured console path", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.admin.console.path = "/qy-console";
			},
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qy-console/install?from=install",
		});

		expect(response.statusCode).toBe(410);
		expect(response.json()).toMatchObject({
			error: {
				code: "INSTALL_ROUTE_DISABLED",
			},
		});
	});

	it("does not register the default retired install route when admin path is customized", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.admin.console.path = "/qy-console";
			},
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/admin/install?from=install",
		});

		expect(response.statusCode).toBe(404);
	});

	it("does not serve the admin shell from unregistered paths", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		for (const url of ["/", "/anything", "/admin/comments"]) {
			const response = await fixture.app.inject({
				method: "GET",
				url,
			});

			expect(response.statusCode).toBe(404);
			expect(response.body).not.toContain("QingYan Admin");
			expect(response.body).not.toContain("window.__QINGYAN_ADMIN__");
		}
	});

	it("does not serve deep admin routes from the configured console path", async () => {
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
		expect(response.statusCode).toBe(404);
		expect(response.body).not.toContain("QingYan Admin");
	});

	it("keeps the dev alias strict when the configured console path differs", async () => {
		const fixture = await createTestApp({
			devMode: true,
			mutateConfig(config) {
				config.admin.console.path = "/qy-console";
			},
		});
		cleanups.push(fixture.cleanup);

		for (const url of ["/admin", "/admin/", "/qy-console", "/qy-console/"]) {
			const response = await fixture.app.inject({
				method: "GET",
				url,
			});
			expect(response.statusCode).toBe(url.endsWith("/") ? 200 : 302);
		}

		for (const url of [
			"/",
			"/admin/install",
			"/admin/comments",
			"/qy-console/install",
			"/qy-console/comments",
			"/anything",
		]) {
			const response = await fixture.app.inject({
				method: "GET",
				url,
			});
			expect(response.statusCode).toBe(url.endsWith("/install") ? 410 : 404);
			expect(response.body).not.toContain("QingYan Admin");
			expect(response.body).not.toContain("window.__QINGYAN_ADMIN__");
		}
	});
});
