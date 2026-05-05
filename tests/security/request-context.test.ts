import { afterEach, describe, expect, it } from "vitest";

import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("request context", () => {
	it("resolves site and visitor from query and cookie", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		fixture.app.get(
			"/__tests/context-query",
			async (request) => request.context,
		);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/__tests/context-query?siteKey=fangyuan&pageKey=post:request-context",
			cookies: {
				qingyan_visitor: "visitor_cookie_1",
			},
			headers: {
				"user-agent": "vitest-agent",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			requestId: expect.stringMatching(/^req_/),
			siteKey: "fangyuan",
			pageKey: "post:request-context",
			visitor: {
				key: "visitor_cookie_1",
				source: "cookie",
			},
			userAgent: "vitest-agent",
		});
	});

	it("resolves siteKey from body payload", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		fixture.app.post(
			"/__tests/context-body",
			async (request) => request.context,
		);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/__tests/context-body",
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:body-context",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			siteKey: "fangyuan",
			pageKey: "post:body-context",
		});
	});
});
