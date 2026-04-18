import { afterEach, describe, expect, it } from "vitest";

import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("openapi docs", () => {
	it("serves yaml, json and docs html", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const yaml = await fixture.app.inject({
			method: "GET",
			url: "/openapi.yaml",
		});
		const json = await fixture.app.inject({
			method: "GET",
			url: "/openapi.json",
		});
		const docs = await fixture.app.inject({
			method: "GET",
			url: "/docs",
		});

		expect(yaml.statusCode).toBe(200);
		expect(yaml.headers["content-type"]).toContain("application/yaml");
		expect(yaml.body).toContain("openapi: 3.1.0");
		expect(yaml.body).toContain("/api/comments/bootstrap");
		expect(yaml.body).toContain("/api/comments/captcha/widget");
		expect(yaml.body).toContain("/api/comments/captcha/complete");
		expect(yaml.body).toContain("iframe_widget");

		expect(json.statusCode).toBe(200);
		expect(json.json()).toMatchObject({
			openapi: "3.1.0",
			info: {
				title: "QingYan API",
			},
		});

		expect(docs.statusCode).toBe(200);
		expect(docs.headers["content-type"]).toContain("text/html");
		expect(docs.body).toContain("QingYan API");
		expect(docs.body).toContain("/openapi.yaml");
	});
});
