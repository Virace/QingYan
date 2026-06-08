import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];
let adminDistDirectory = "";

type CreateTestAppOptions = Parameters<typeof createTestApp>[0];

function createAdminUiTestApp(options?: CreateTestAppOptions) {
	return createTestApp({
		...options,
		adminDistDirectory,
	});
}

beforeAll(() => {
	adminDistDirectory = mkdtempSync(path.join(tmpdir(), "qingyan-admin-dist-"));
	const assetsDirectory = path.join(adminDistDirectory, "assets");
	mkdirSync(assetsDirectory, { recursive: true });
	writeFileSync(
		path.join(adminDistDirectory, "index.html"),
		`<!doctype html>
<html lang="zh-CN">
	<head>
		<meta charset="UTF-8" />
		<title>QingYan Admin</title>
		<script type="module" crossorigin src="./assets/admin-test.js"></script>
	</head>
	<body>
		<div id="root"></div>
	</body>
</html>`,
	);
	writeFileSync(
		path.join(assetsDirectory, "admin-test.js"),
		"globalThis.__qingyanAdminTestAsset = true;\n",
	);
});

afterAll(() => {
	if (adminDistDirectory) {
		rmSync(adminDistDirectory, { recursive: true, force: true });
	}
});

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin ui", () => {
	it("redirects the extensionless admin entry to the slash route", async () => {
		const fixture = await createAdminUiTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/admin",
		});

		expect(response.statusCode).toBe(302);
		expect(response.headers.location).toBe("/qingyan/admin/");
	});

	it("serves the admin shell at /admin/", async () => {
		const fixture = await createAdminUiTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/admin/",
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toContain("text/html");
		expect(response.body).toContain("QingYan Admin");
		expect(response.body).toContain('id="root"');
		expect(response.body).not.toContain('id="admin-root"');
		expect(response.body).toContain("window.__QINGYAN_ADMIN__");
		expect(response.body).toContain('"basePath":"/qingyan/admin"');
		expect(response.body).toContain('"apiBase":"/qingyan/api"');
	});

	it("serves built admin assets when build output exists", async () => {
		const fixture = await createAdminUiTestApp();
		cleanups.push(fixture.cleanup);

		const shell = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/admin/",
		});
		const assetMatch = shell.body.match(/src="\.\/assets\/([^"]+\.js)"/);
		const assetName = assetMatch?.[1];
		expect(assetName).toBe("admin-test.js");
		if (!assetName) {
			throw new Error("Expected built admin asset reference.");
		}

		const response = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/admin/assets/${assetName}`,
		});
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toContain("text/javascript");
	});

	it("returns a deployment error when the built admin shell is missing", async () => {
		const missingDistDirectory = mkdtempSync(
			path.join(tmpdir(), "qingyan-admin-missing-"),
		);
		cleanups.push(async () => {
			rmSync(missingDistDirectory, { recursive: true, force: true });
		});
		const fixture = await createTestApp({
			adminDistDirectory: missingDistDirectory,
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/admin/",
		});

		expect(response.statusCode).toBe(503);
		expect(response.json()).toMatchObject({
			error: {
				code: "ADMIN_UI_NOT_BUILT",
			},
		});
		expect(response.body).not.toContain('id="admin-root"');
		expect(response.body).not.toContain("root.innerHTML");
	});

	it("rejects admin asset path traversal", async () => {
		const fixture = await createAdminUiTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/admin/assets/%2e%2e%2findex.html",
		});

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({
			error: {
				code: "ADMIN_ASSET_NOT_FOUND",
			},
		});
	});

	it("blocks the retired install route under the configured console path", async () => {
		const fixture = await createAdminUiTestApp({
			mutateConfig(config) {
				config.admin.console.path = "/qy-console";
			},
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/qy-console/install?from=install",
		});

		expect(response.statusCode).toBe(410);
		expect(response.json()).toMatchObject({
			error: {
				code: "INSTALL_ROUTE_DISABLED",
			},
		});
	});

	it("does not register the default retired install route when admin path is customized", async () => {
		const fixture = await createAdminUiTestApp({
			mutateConfig(config) {
				config.admin.console.path = "/qy-console";
			},
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/admin/install?from=install",
		});

		expect(response.statusCode).toBe(404);
	});

	it("does not serve the admin shell from unregistered paths", async () => {
		const fixture = await createAdminUiTestApp();
		cleanups.push(fixture.cleanup);

		for (const url of ["/", "/anything", "/qingyan/admin/comments"]) {
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
		const fixture = await createAdminUiTestApp({
			mutateConfig(config) {
				config.admin.console.path = "/qy-console";
			},
		});
		cleanups.push(fixture.cleanup);

		const oldRoute = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/admin",
		});
		expect(oldRoute.statusCode).toBe(404);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/qy-console/comments",
		});
		expect(response.statusCode).toBe(404);
		expect(response.body).not.toContain("QingYan Admin");
	});

	it("injects the public API base for a custom console path", async () => {
		const fixture = await createAdminUiTestApp({
			mutateConfig(config) {
				config.admin.console.path = "/qy-console";
			},
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/qy-console/",
		});

		expect(response.statusCode).toBe(200);
		expect(response.body).toContain('"basePath":"/qingyan/qy-console"');
		expect(response.body).toContain('"apiBase":"/qingyan/api"');
	});

	it("keeps the dev alias strict when the configured console path differs", async () => {
		const fixture = await createAdminUiTestApp({
			devMode: true,
			mutateConfig(config) {
				config.admin.console.path = "/qy-console";
			},
		});
		cleanups.push(fixture.cleanup);

		for (const url of [
			"/qingyan/admin",
			"/qingyan/admin/",
			"/qingyan/qy-console",
			"/qingyan/qy-console/",
		]) {
			const response = await fixture.app.inject({
				method: "GET",
				url,
			});
			expect(response.statusCode).toBe(url.endsWith("/") ? 200 : 302);
		}

		for (const url of [
			"/",
			"/qingyan/admin/install",
			"/qingyan/admin/comments",
			"/qingyan/qy-console/install",
			"/qingyan/qy-console/comments",
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
