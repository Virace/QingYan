import { afterEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../../src/config/types";
import { runtimeSettings } from "../../src/db/schema";
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
			url: "/api/comments",
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
		await fixture.app.db.update(runtimeSettings).set({
			captchaMode: "never",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
			headers: {
				origin: "http://localhost:4321",
			},
			payload: commentPayload("post:allowed-origin"),
		});

		expect(response.statusCode).toBe(200);
	});

	it("rejects public writes from an origin outside the site's allowedOrigins", async () => {
		const fixture = await createTestApp({
			mutateConfig: requireOrigin,
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
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
			url: "/api/page-feedback/like",
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
			url: "/api/page-feedback/like",
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:missing-origin-opt-out",
				pageTitle: "Missing Origin Opt Out",
				pageUrl: "https://fangyuan.example.com/posts/missing-origin-opt-out/",
			},
		});

		expect(response.statusCode).toBe(200);
	});

	it("allows dev memory mode writes without Origin for local integration", async () => {
		const fixture = await createTestApp({
			devMode: true,
			devAdminToken: "dev-token",
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/page-feedback/like",
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
