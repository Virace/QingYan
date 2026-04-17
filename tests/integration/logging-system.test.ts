import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("logging system", () => {
	it("creates access and app text/jsonl files under the configured logs directory", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const today = new Date().toISOString().slice(0, 10);

		await fixture.app.loggerManager.logApp({
			level: "info",
			channel: "app",
			event: "service.started",
			message: "服务已启动",
		});

		const bootstrap = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:logging",
		});

		expect(bootstrap.statusCode).toBe(200);
		expect(
			existsSync(path.join(fixture.logsDirectory, "app", `${today}.jsonl`)),
		).toBe(true);
		expect(
			existsSync(path.join(fixture.logsDirectory, "app", `${today}.log`)),
		).toBe(true);
		expect(
			existsSync(path.join(fixture.logsDirectory, "access", `${today}.jsonl`)),
		).toBe(true);
		expect(
			existsSync(path.join(fixture.logsDirectory, "access", `${today}.log`)),
		).toBe(true);
	});

	it("writes request facts into the access jsonl channel", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const today = new Date().toISOString().slice(0, 10);

		const healthz = await fixture.app.inject({
			method: "GET",
			url: "/healthz",
		});
		expect(healthz.statusCode).toBe(200);

		const bootstrap = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:logging-access",
		});

		expect(bootstrap.statusCode).toBe(200);

		const accessJsonl = readFileSync(
			path.join(fixture.logsDirectory, "access", `${today}.jsonl`),
			"utf-8",
		);
		expect(accessJsonl).toContain('"channel":"access"');
		expect(accessJsonl).toContain('"event":"request.completed"');
		expect(accessJsonl).toContain('"/api/comments/bootstrap"');
		expect(accessJsonl).toContain('"pageKey":"post:logging-access"');
		expect(accessJsonl).not.toContain("/healthz");
	});
});
