import { describe, expect, it } from "vitest";

import {
	AkismetClient,
	parseAkismetCommentCheckResponse,
} from "../../src/modules/comments/akismet-client";

describe("Akismet client", () => {
	it("parses ham, spam, pro-tip, debug and recheck response values", async () => {
		await expect(
			parseAkismetCommentCheckResponse(
				new Response("false", {
					headers: {
						"x-akismet-recheck-after": "900",
					},
				}),
			),
		).resolves.toMatchObject({
			verdict: "ham",
			recheckAfterSec: 900,
		});

		await expect(
			parseAkismetCommentCheckResponse(
				new Response("true", {
					headers: {
						"x-akismet-pro-tip": "discard",
						"x-akismet-debug-help": "debug message",
					},
				}),
			),
		).resolves.toMatchObject({
			verdict: "spam",
			proTip: "discard",
			debugHelp: "debug message",
		});

		await expect(
			parseAkismetCommentCheckResponse(new Response("invalid")),
		).resolves.toMatchObject({
			verdict: "error",
		});
	});

	it("posts form encoded comment-check payloads", async () => {
		const requests: Request[] = [];
		const client = new AkismetClient({
			fetch: async (input, init) => {
				const request = new Request(input, init);
				requests.push(request);
				return new Response("true", {
					headers: {
						"x-akismet-pro-tip": "discard",
					},
				});
			},
		});

		const result = await client.commentCheck({
			apiKey: "test-key",
			blog: "https://example.com",
			userIp: "203.0.113.10",
			userAgent: "Test Browser",
			referrer: "https://referrer.example",
			permalink: "https://example.com/post",
			commentType: "comment",
			commentAuthor: "Alice",
			commentAuthorEmail: "alice@example.com",
			commentAuthorUrl: "https://alice.example",
			commentContent: "hello",
			commentDateGmt: "2026-05-26T10:00:00.000Z",
			isTest: true,
		});

		expect(result).toMatchObject({
			verdict: "spam",
			proTip: "discard",
		});
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("https://rest.akismet.com/1.1/comment-check");
		expect(requests[0]?.method).toBe("POST");
		expect(requests[0]?.headers.get("content-type")).toContain(
			"application/x-www-form-urlencoded",
		);
		const body = new URLSearchParams(await requests[0]?.text());
		expect(body.get("api_key")).toBe("test-key");
		expect(body.get("blog")).toBe("https://example.com");
		expect(body.get("user_ip")).toBe("203.0.113.10");
		expect(body.get("comment_content")).toBe("hello");
		expect(body.get("is_test")).toBe("true");
	});
});
