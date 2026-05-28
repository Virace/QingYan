import { describe, expect, it } from "vitest";

import {
	getPageSourceEntryRejectionReason,
	normalizePageSourceEntry,
} from "../../src/modules/page-registry/source-normalizer";

describe("normalizePageSourceEntry", () => {
	it("accepts allowed-origin content URLs and stores root-relative page URLs", () => {
		const resolved = normalizePageSourceEntry({
			entry: {
				url: "https://example.com/posts/a/?utm=1#x",
				sourceKind: "sitemap",
				warnings: [],
			},
			allowedOrigins: ["https://example.com"],
		});

		expect(resolved).toEqual({
			pageKey: "posts/a/",
			pageUrl: "/posts/a/",
			warnings: [],
		});
	});

	it.each([
		["https://example.com/sitemap.xml", "source_path"],
		["https://example.com/feed.xml", "source_path"],
		["https://example.com/api/comments", "api_path"],
		["https://example.com/assets/app.js", "asset_path"],
		["https://other.example.com/posts/a/", "cross_origin"],
	])("rejects %s with %s", (url, reason) => {
		const resolved = normalizePageSourceEntry({
			entry: {
				url,
				sourceKind: "sitemap",
				warnings: [],
			},
			allowedOrigins: ["https://example.com"],
		});

		expect(resolved).toBeNull();
		expect(
			getPageSourceEntryRejectionReason({
				entry: {
					url,
					sourceKind: "sitemap",
					warnings: ["source"],
				},
				allowedOrigins: ["https://example.com"],
			}),
		).toBe(reason);
	});

	it("preserves entry title and warnings", () => {
		const resolved = normalizePageSourceEntry({
			entry: {
				url: "https://example.com/posts/titled/",
				title: "Titled",
				sourceKind: "rss",
				warnings: ["rss-guid-missing"],
			},
			allowedOrigins: ["https://example.com"],
		});

		expect(resolved).toEqual({
			pageKey: "posts/titled/",
			pageUrl: "/posts/titled/",
			title: "Titled",
			warnings: ["rss-guid-missing"],
		});
	});
});
