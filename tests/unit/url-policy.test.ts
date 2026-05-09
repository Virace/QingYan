import { describe, expect, it } from "vitest";

import {
	isSafeHttpUrl,
	normalizeOriginList,
	normalizeSafeHttpUrl,
} from "../../src/modules/shared/url-policy";

describe("url policy", () => {
	it("accepts only http and https absolute urls", () => {
		expect(isSafeHttpUrl("https://example.com")).toBe(true);
		expect(isSafeHttpUrl("http://example.com/path")).toBe(true);
		expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
		expect(isSafeHttpUrl("/relative")).toBe(false);
	});

	it("normalizes safe website urls and rejects unsafe ones", () => {
		expect(normalizeSafeHttpUrl(" https://example.com/about ")).toBe(
			"https://example.com/about",
		);
		expect(() => normalizeSafeHttpUrl("javascript:alert(1)")).toThrow(
			/http\(s\)/i,
		);
	});

	it("normalizes origins by removing trailing slash and deduplicating", () => {
		expect(
			normalizeOriginList([
				"https://admin.example.com/",
				"https://admin.example.com",
				"http://localhost:5173/",
			]),
		).toEqual(["https://admin.example.com", "http://localhost:5173"]);
	});

	it("rejects origins with path query or fragment", () => {
		expect(() =>
			normalizeOriginList(["https://admin.example.com/path"]),
		).toThrow(/origin/i);
		expect(() =>
			normalizeOriginList(["https://admin.example.com?x=1"]),
		).toThrow(/origin/i);
		expect(() =>
			normalizeOriginList(["https://admin.example.com#frag"]),
		).toThrow(/origin/i);
	});
});
