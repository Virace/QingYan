import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:logging",
			headers: refererFor("post:logging"),
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
			url: "/qingyan/healthz",
		});
		expect(healthz.statusCode).toBe(200);

		const bootstrap = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:logging-access",
			headers: refererFor("post:logging-access"),
		});

		expect(bootstrap.statusCode).toBe(200);

		const accessJsonl = readFileSync(
			path.join(fixture.logsDirectory, "access", `${today}.jsonl`),
			"utf-8",
		);
		expect(accessJsonl).toContain('"channel":"access"');
		expect(accessJsonl).toContain('"event":"request.completed"');
		expect(accessJsonl).toContain('"/qingyan/api/comments/bootstrap"');
		expect(accessJsonl).toContain('"pageKey":"post:logging-access"');
		expect(accessJsonl).not.toContain("/qingyan/healthz");
	});

	it("writes unhandled request errors into the app jsonl channel", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const today = new Date().toISOString().slice(0, 10);
		await fixture.app.get("/qingyan/api/__boom", async () => {
			throw new Error("logging probe failure");
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/__boom",
			headers: {
				"x-request-id": "req_logging_probe",
			},
		});

		expect(response.statusCode).toBe(500);
		expect(response.json()).toMatchObject({
			error: {
				code: "INTERNAL_ERROR",
				requestId: "req_logging_probe",
			},
		});

		const appJsonl = readFileSync(
			path.join(fixture.logsDirectory, "app", `${today}.jsonl`),
			"utf-8",
		);
		expect(appJsonl).toContain('"channel":"app"');
		expect(appJsonl).toContain('"event":"service.crashed"');
		expect(appJsonl).toContain('"requestId":"req_logging_probe"');
		expect(appJsonl).toContain('"message":"Unhandled request error"');
		expect(appJsonl).toContain('"name":"Error"');
		expect(appJsonl).toContain('"errorMessage":"logging probe failure"');
		expect(appJsonl).toContain('"path":"/qingyan/api/__boom"');
	});
});
