import { afterEach, describe, expect, it } from "vitest";

import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("global flood guard", () => {
	it("returns GLOBAL_RATE_LIMITED after hitting the global request ceiling", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		fixture.app.config.security.globalFloodGuard.enabled = true;
		fixture.app.config.security.globalFloodGuard.windowSec = 10;
		fixture.app.config.security.globalFloodGuard.maxRequests = 2;

		const url = "/api/comments/thread?siteKey=fangyuan&pageKey=post:flood";

		expect((await fixture.app.inject({ method: "GET", url })).statusCode).toBe(
			200,
		);
		expect((await fixture.app.inject({ method: "GET", url })).statusCode).toBe(
			200,
		);

		const blocked = await fixture.app.inject({ method: "GET", url });

		expect(blocked.statusCode).toBe(429);
		expect(blocked.json()).toMatchObject({
			error: {
				code: "GLOBAL_RATE_LIMITED",
			},
		});
	});
});
