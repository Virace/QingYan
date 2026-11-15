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
		const recovery = blocked.json().error.recovery;
		expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
		expect(Number(blocked.headers["retry-after"])).toBeLessThanOrEqual(10);
		expect(recovery.retryAfterSec).toBe(Number(blocked.headers["retry-after"]));
		const explanation = await fixture.app.inject(recovery.helpUrl);
		expect(explanation.statusCode).toBe(200);
		expect(explanation.headers["content-type"]).toContain("text/html");
		expect(explanation.body).toContain("操作过于频繁");
	});
});
