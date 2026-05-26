import { afterEach, describe, expect, it, vi } from "vitest";

import {
	clearAdminCsrf,
	requestJson,
	updateAdminCsrf,
} from "../../apps/admin/src/api/client";

describe("admin API client", () => {
	afterEach(() => {
		clearAdminCsrf();
		vi.restoreAllMocks();
	});

	it("refreshes csrf and retries one admin write after a stale csrf response", async () => {
		updateAdminCsrf({
			header: "x-qingyan-csrf-token",
			token: "stale-token",
		});
		const fetchMock = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url === "/api/admin/import-export/wordpress/analyze") {
					const token = new Headers(init?.headers).get("x-qingyan-csrf-token");
					if (token === "stale-token") {
						return new Response(
							JSON.stringify({
								error: {
									code: "ADMIN_CSRF_INVALID",
									message: "后台写请求 CSRF token 无效。",
								},
							}),
							{
								status: 403,
								headers: { "content-type": "application/json" },
							},
						);
					}
					return Response.json({ ok: true });
				}
				if (url === "/api/admin/session/me") {
					return Response.json({
						authenticated: true,
						session: { expiresAt: "2026-05-27T00:00:00.000Z" },
						csrf: {
							header: "x-qingyan-csrf-token",
							token: "fresh-token",
						},
						sites: [],
					});
				}
				return new Response("not found", { status: 404 });
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await requestJson<{ ok: true }>(
			"/api/admin/import-export/wordpress/analyze",
			{
				method: "POST",
				body: "<rss />",
				headers: { "content-type": "text/xml" },
			},
		);

		expect(result).toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"/api/admin/import-export/wordpress/analyze",
		);
		expect(
			new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get(
				"x-qingyan-csrf-token",
			),
		).toBe("stale-token");
		expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/admin/session/me");
		expect(
			new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get(
				"x-qingyan-csrf-token",
			),
		).toBe("fresh-token");
	});
});
