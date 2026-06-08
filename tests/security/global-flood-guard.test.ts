import { afterEach, describe, expect, it } from "vitest";

import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

function refererFor(pageKey: string) {
	return {
		referer: `http://localhost:4321/${pageKey}`,
	};
}

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("global flood guard", () => {
	it("returns GLOBAL_RATE_LIMITED after hitting the global request ceiling", async () => {
		const fixture = await createTestApp({
			mutateConfig(config) {
				config.security.globalFloodGuard.enabled = true;
				config.security.globalFloodGuard.windowSec = 10;
				config.security.globalFloodGuard.maxRequests = 2;
			},
		});
		cleanups.push(fixture.cleanup);

		const url =
			"/qingyan/api/comments/thread?siteKey=fangyuan&pageKey=post:flood";

		expect(
			(
				await fixture.app.inject({
					method: "GET",
					url,
					headers: refererFor("post:flood"),
				})
			).statusCode,
		).toBe(200);
		expect(
			(
				await fixture.app.inject({
					method: "GET",
					url,
					headers: refererFor("post:flood"),
				})
			).statusCode,
		).toBe(200);

		const blocked = await fixture.app.inject({
			method: "GET",
			url,
			headers: refererFor("post:flood"),
		});

		expect(blocked.statusCode).toBe(429);
		expect(blocked.json()).toMatchObject({
			error: {
				code: "GLOBAL_RATE_LIMITED",
			},
		});
	});
});
