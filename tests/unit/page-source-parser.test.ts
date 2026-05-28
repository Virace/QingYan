import { describe, expect, it } from "vitest";

import { parsePageSourceXml } from "../../src/modules/page-registry/source-parser";

describe("parsePageSourceXml", () => {
	it("parses sitemap urlset entries", () => {
		const parsed = parsePageSourceXml(
			"<urlset><url><loc>https://example.com/a/</loc></url></urlset>",
			"sitemap",
		);

		expect(parsed).toEqual({
			entries: [
				{
					url: "https://example.com/a/",
					sourceKind: "sitemap",
					warnings: [],
				},
			],
			sitemapUrls: [],
		});
	});

	it("parses RSS item title and link", () => {
		const parsed = parsePageSourceXml(
			"<rss><channel><item><title><![CDATA[Hello]]></title><link><![CDATA[https://example.com/hello/]]></link></item></channel></rss>",
			"rss",
		);

		expect(parsed.entries).toEqual([
			{
				url: "https://example.com/hello/",
				title: "Hello",
				sourceKind: "rss",
				warnings: [],
			},
		]);
		expect(parsed.sitemapUrls).toEqual([]);
	});

	it("parses Atom entry title and href link", () => {
		const parsed = parsePageSourceXml(
			'<feed><entry><title>Atom Title</title><link href="https://example.com/atom/" /></entry></feed>',
			"atom",
		);

		expect(parsed.entries).toEqual([
			{
				url: "https://example.com/atom/",
				title: "Atom Title",
				sourceKind: "atom",
				warnings: [],
			},
		]);
		expect(parsed.sitemapUrls).toEqual([]);
	});

	it("parses sitemap index child sitemap URLs", () => {
		const parsed = parsePageSourceXml(
			"<sitemapindex><sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap></sitemapindex>",
			"sitemap",
		);

		expect(parsed.entries).toEqual([]);
		expect(parsed.sitemapUrls).toEqual([
			"https://example.com/post-sitemap.xml",
		]);
	});
});
