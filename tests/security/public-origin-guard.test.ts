import { afterEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../../src/config/types";
import { siteSettings } from "../../src/db/schema";
import { AdminSystemSettingsRepository } from "../../src/modules/admin/system-settings-repository";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

function allowMissingOrigin(config: AppConfig): void {
	config.security.publicOriginGuard.allowMissingOrigin = true;
}

function requireOrigin(config: AppConfig): void {
	config.security.publicOriginGuard.allowMissingOrigin = false;
}

function commentPayload(pageKey = "post:origin-guard") {
	return {
		siteKey: "fangyuan",
		pageKey,
		pageTitle: "Origin Guard",
		pageUrl: "https://fangyuan.example.com/posts/origin-guard/",
		parentCommentId: null,
		author: {
			name: "Alice",
			email: "alice@example.com",
		},
		content: {
			raw: "hello qingyan",
		},
		options: {
			notifyOnReply: false,
		},
	};
}

describe("public origin guard", () => {
	it("answers CORS preflight for a configured frontend origin", async () => {
		const fixture = await createTestApp({
			mutateConfig: requireOrigin,
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "OPTIONS",
			url: "/qingyan/api/comments",
			headers: {
				origin: "http://localhost:4321",
				"access-control-request-method": "POST",
				"access-control-request-headers": "content-type",
			},
		});

		expect(response.statusCode).toBe(204);
		expect(response.headers["access-control-allow-origin"]).toBe(
			"http://localhost:4321",
		);
		expect(response.headers["access-control-allow-credentials"]).toBe("true");
		expect(response.headers["access-control-allow-methods"]).toContain("POST");
		expect(response.headers["access-control-allow-headers"]).toContain(
			"content-type",
		);
	});

	it("allows public writes from a configured localhost frontend origin", async () => {
		const fixture = await createTestApp({
			mutateConfig: requireOrigin,
		});
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				origin: "http://localhost:4321",
			},
			payload: commentPayload("post:allowed-origin"),
		});

		expect(response.statusCode).toBe(200);
	});

	it("uses updated DB-owned allowedOrigins for public writes", async () => {
		const fixture = await createTestApp({
			mutateConfig: requireOrigin,
		});
		cleanups.push(fixture.cleanup);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
		});
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const update = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/sites/fangyuan",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				allowedOrigins: ["https://new.example.com"],
			},
		});
		expect(update.statusCode).toBe(200);

		const oldOrigin = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				origin: "http://localhost:4321",
			},
			payload: commentPayload("post:old-origin"),
		});
		expect(oldOrigin.statusCode).toBe(403);

		const newOrigin = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				origin: "https://new.example.com",
			},
			payload: commentPayload("post:new-origin"),
		});
		expect(newOrigin.statusCode).toBe(200);
	});

	it("rejects public writes from an origin outside the site's allowedOrigins", async () => {
		const fixture = await createTestApp({
			mutateConfig: requireOrigin,
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				origin: "https://evil.example",
			},
			payload: commentPayload("post:blocked-origin"),
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "PUBLIC_ORIGIN_FORBIDDEN",
			},
		});
	});

	it("blocks public writes without Origin unless explicitly allowed", async () => {
		const fixture = await createTestApp({
			mutateConfig: requireOrigin,
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:missing-origin",
				pageTitle: "Missing Origin",
				pageUrl: "https://fangyuan.example.com/posts/missing-origin/",
			},
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "PUBLIC_ORIGIN_REQUIRED",
			},
		});
	});

	it("allows public writes without Origin when the deployment opts out", async () => {
		const fixture = await createTestApp({
			mutateConfig: allowMissingOrigin,
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:missing-origin-opt-out",
				pageTitle: "Missing Origin Opt Out",
				pageUrl: "https://fangyuan.example.com/posts/missing-origin-opt-out/",
			},
		});

		expect(response.statusCode).toBe(200);
	});

	it("uses runtime public origin guard settings from system settings", async () => {
		const fixture = await createTestApp({
			mutateConfig: requireOrigin,
		});
		cleanups.push(fixture.cleanup);

		const systemSettings = new AdminSystemSettingsRepository(fixture.app.db);
		await systemSettings.upsert("security", "publicOriginGuard.enabled", true);
		await systemSettings.upsert(
			"security",
			"publicOriginGuard.allowMissingOrigin",
			true,
		);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:runtime-missing-origin",
				pageTitle: "Runtime Missing Origin",
				pageUrl: "https://fangyuan.example.com/posts/runtime-missing-origin/",
			},
		});

		expect(response.statusCode).toBe(200);
	});

	it("uses runtime admin origin guard settings from system settings", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const systemSettings = new AdminSystemSettingsRepository(fixture.app.db);

		await systemSettings.upsert("security", "adminOriginGuard.enabled", true);
		await systemSettings.upsert(
			"security",
			"adminOriginGuard.allowMissingOrigin",
			false,
		);
		await systemSettings.upsert("security", "adminOriginGuard.allowedOrigins", [
			"https://admin.example.test",
		]);

		const oldOrigin = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/sites/fangyuan",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
				origin: "http://localhost:4401",
			}),
			payload: {
				name: "Blocked Origin",
			},
		});
		expect(oldOrigin.statusCode).toBe(403);
		expect(oldOrigin.json()).toMatchObject({
			error: {
				code: "ADMIN_ORIGIN_FORBIDDEN",
			},
		});

		const runtimeOrigin = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/sites/fangyuan",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
				origin: "https://admin.example.test",
			}),
			payload: {
				name: "Allowed Runtime Origin",
			},
		});
		expect(runtimeOrigin.statusCode).toBe(200);
	});

	it("allows dev memory mode writes without Origin for local integration", async () => {
		const fixture = await createTestApp({
			devMode: true,
			devAdminToken: "dev-token",
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			payload: {
				siteKey: "default",
				pageKey: "post:dev-origin",
				pageTitle: "Dev Origin",
				pageUrl: "https://example.test/posts/dev-origin/",
			},
		});

		expect(response.statusCode).toBe(200);
	});
});
