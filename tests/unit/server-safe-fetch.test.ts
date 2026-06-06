import { describe, expect, it } from "vitest";

import { safeFetchText } from "../../src/modules/shared/server-safe-fetch";
import { AppError } from "../../src/modules/shared/errors";

function response(
	body: string,
	input: { status?: number; location?: string } = {},
): Response {
	return new Response(body, {
		status: input.status ?? 200,
		headers: input.location ? { location: input.location } : undefined,
	});
}

async function expectAppError(
	action: () => Promise<unknown>,
	code: string,
): Promise<void> {
	try {
		await action();
		throw new Error("Expected AppError.");
	} catch (error) {
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).code).toBe(code);
	}
}

describe("safeFetchText", () => {
	it("fetches allowed public HTTP text", async () => {
		const result = await safeFetchText("https://example.com/sitemap.xml", {
			allowedOrigins: ["https://example.com"],
			lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
			fetchImpl: async () => response("<urlset />"),
		});

		expect(result).toEqual({
			status: 200,
			url: "https://example.com/sitemap.xml",
			text: "<urlset />",
		});
	});

	it("rejects loopback and private initial destinations", async () => {
		await expectAppError(
			() =>
				safeFetchText("http://127.0.0.1/sitemap.xml", {
					allowedOrigins: ["http://127.0.0.1"],
					lookupHost: async () => [{ address: "127.0.0.1", family: 4 }],
					fetchImpl: async () => response("internal"),
				}),
			"SERVER_FETCH_DESTINATION_DENIED",
		);

		await expectAppError(
			() =>
				safeFetchText("http://10.0.0.8/sitemap.xml", {
					allowedOrigins: ["http://10.0.0.8"],
					lookupHost: async () => [{ address: "10.0.0.8", family: 4 }],
					fetchImpl: async () => response("internal"),
				}),
			"SERVER_FETCH_DESTINATION_DENIED",
		);

		await expectAppError(
			() =>
				safeFetchText("https://example.com/sitemap.xml", {
					allowedOrigins: ["https://example.com"],
					lookupHost: async () => [{ address: "::ffff:0a00:0008", family: 6 }],
					fetchImpl: async () => response("internal"),
				}),
			"SERVER_FETCH_DESTINATION_DENIED",
		);
	});

	it("rejects redirects to private or untrusted origins", async () => {
		await expectAppError(
			() =>
				safeFetchText("https://example.com/sitemap.xml", {
					allowedOrigins: ["https://example.com"],
					lookupHost: async (hostname) => [
						{
							address:
								hostname === "example.com" ? "93.184.216.34" : "127.0.0.1",
							family: 4,
						},
					],
					fetchImpl: async () =>
						response("", {
							status: 302,
							location: "http://127.0.0.1/internal",
						}),
				}),
			"SERVER_FETCH_REDIRECT_DENIED",
		);

		await expectAppError(
			() =>
				safeFetchText("https://example.com/sitemap.xml", {
					allowedOrigins: ["https://example.com"],
					lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
					fetchImpl: async () =>
						response("", {
							status: 302,
							location: "https://evil.example/sitemap.xml",
						}),
				}),
			"SERVER_FETCH_REDIRECT_DENIED",
		);
	});

	it("rejects excessive redirects", async () => {
		await expectAppError(
			() =>
				safeFetchText("https://example.com/0.xml", {
					allowedOrigins: ["https://example.com"],
					maxRedirects: 5,
					lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
					fetchImpl: async (url) => {
						const current = Number(
							new URL(url.toString()).pathname.match(/\d+/)?.[0] ?? 0,
						);
						return response("", {
							status: 302,
							location: `/${current + 1}.xml`,
						});
					},
				}),
			"SERVER_FETCH_TOO_MANY_REDIRECTS",
		);
	});

	it("rejects oversized responses", async () => {
		await expectAppError(
			() =>
				safeFetchText("https://example.com/sitemap.xml", {
					allowedOrigins: ["https://example.com"],
					maxBytes: 4,
					lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
					fetchImpl: async () => response("too large"),
				}),
			"SERVER_FETCH_TOO_LARGE",
		);
	});
});
