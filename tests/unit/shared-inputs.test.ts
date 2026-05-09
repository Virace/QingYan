import { describe, expect, it } from "vitest";

import {
	normalizePagePath,
	resolvePublicPageUrl,
} from "../../src/modules/shared/page-url";
import { normalizePagination } from "../../src/modules/shared/pagination";

describe("shared page url helpers", () => {
	it("normalizes absolute urls and root-relative paths to page paths", () => {
		expect(
			normalizePagePath(" https://fangyuan.example.com/posts/a/?x=1 "),
		).toBe("/posts/a/");
		expect(normalizePagePath("/posts/a/?x=1#comments")).toBe("/posts/a/");
		expect(normalizePagePath("not-a-url")).toBeUndefined();
	});

	it("resolves public page urls from the primary allowed origin", () => {
		expect(
			resolvePublicPageUrl("/posts/a/?draft=1", [
				"https://fangyuan.example.com",
				"https://preview.example.com",
			]),
		).toBe("https://fangyuan.example.com/posts/a/");
	});

	it("keeps absolute urls when no allowed origin is configured", () => {
		expect(
			resolvePublicPageUrl("https://preview.example.com/posts/a/?draft=1", []),
		).toBe("https://preview.example.com/posts/a/?draft=1");
		expect(resolvePublicPageUrl("/posts/a/", [])).toBe("/posts/a/");
	});
});

describe("shared pagination helper", () => {
	it("defaults pagination for missing or invalid values", () => {
		expect(
			normalizePagination({
				sortBy: "unexpected",
				limit: Number.NaN,
				offset: Number.NaN,
			}),
		).toEqual({
			sortBy: "newest",
			limit: 20,
			offset: 0,
		});
	});

	it("clamps numeric limits and offsets", () => {
		expect(
			normalizePagination({ sortBy: "oldest", limit: 200, offset: -5 }),
		).toEqual({
			sortBy: "oldest",
			limit: 100,
			offset: 0,
		});
		expect(normalizePagination({ limit: 0, offset: 3 })).toEqual({
			sortBy: "newest",
			limit: 1,
			offset: 3,
		});
	});
});
