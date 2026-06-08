import { afterEach, describe, expect, it } from "vitest";

import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("public path routing", () => {
	it("serves normal app routes only under the configured public path", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const rootHealthz = await fixture.app.inject({
			method: "GET",
			url: "/healthz",
		});
		const prefixedHealthz = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/healthz",
		});
		const rootBootstrap = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:prefix",
		});
		const prefixedBootstrap = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:prefix",
		});

		expect(rootHealthz.statusCode).toBe(404);
		expect(prefixedHealthz.statusCode).toBe(200);
		expect(prefixedHealthz.json()).toEqual({
			service: "QingYan",
			status: "ok",
		});
		expect(rootBootstrap.statusCode).toBe(404);
		expect(prefixedBootstrap.statusCode).not.toBe(404);
	});
});
