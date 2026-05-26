import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	getDistHtmlCandidates,
	parseStaticSiteIndex,
	parseSitemapIndexUrls,
	verifyDistTarget,
} from "../../../src/modules/import-export/wordpress/dist-verifier";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

function createTempDist() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-dist-"));
	cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
	return directory;
}

describe("getDistHtmlCandidates", () => {
	it("maps static paths to likely dist HTML files", () => {
		const root = "dist";
		expect(getDistHtmlCandidates(root, "foo.html")).toEqual([
			path.join(root, "foo.html"),
		]);
		expect(getDistHtmlCandidates(root, "/foo/")).toEqual([
			path.join(root, "foo/", "index.html"),
		]);
	});
});

describe("verifyDistTarget", () => {
	it("verifies when dist file, canonical path, and title match", () => {
		const dist = createTempDist();
		writeFileSync(
			path.join(dist, "termux.html"),
			`<html><head><title>Termux</title><link rel="canonical" href="https://x-item.com/termux.html"></head><body><h1>Termux</h1></body></html>`,
			"utf-8",
		);

		expect(
			verifyDistTarget({
				targetDistRoot: dist,
				targetPath: "termux.html",
				sourceTitle: "Termux",
				sourcePath: "/termux.html",
				sourceRelativePath: "termux.html",
				wpPostId: "1",
			}),
		).toMatchObject({
			status: "verified",
			confidence: 90,
			title: "Termux",
		});
	});

	it("returns missing when no candidate file exists", () => {
		const dist = createTempDist();
		expect(
			verifyDistTarget({
				targetDistRoot: dist,
				targetPath: "missing.html",
				sourceTitle: "Missing",
				sourcePath: "/missing.html",
				sourceRelativePath: "missing.html",
				wpPostId: "1",
			}),
		).toMatchObject({ status: "missing" });
	});

	it("does not treat a directory itself as an ambiguous HTML candidate", () => {
		const dist = createTempDist();
		mkdirSync(path.join(dist, "guestbook"), { recursive: true });
		writeFileSync(
			path.join(dist, "guestbook", "index.html"),
			`<title>留言板</title><h1>留言板</h1>`,
			"utf-8",
		);

		expect(
			verifyDistTarget({
				targetDistRoot: dist,
				targetPath: "guestbook",
				sourceTitle: "留言板",
				sourcePath: "/guestbook",
				sourceRelativePath: "guestbook",
				wpPostId: "1495",
			}),
		).toMatchObject({
			status: "verified",
			confidence: 85,
			reasons: ["dist_file_exists", "source_path_match", "title_match"],
		});
	});

	it("accepts trailing slash differences for WordPress page URLs", () => {
		const dist = createTempDist();
		mkdirSync(path.join(dist, "links"), { recursive: true });
		writeFileSync(
			path.join(dist, "links", "index.html"),
			`<title>友情链接</title><h1>友情链接</h1>`,
			"utf-8",
		);

		expect(
			verifyDistTarget({
				targetDistRoot: dist,
				targetPath: "/links/",
				sourceTitle: "友情链接",
				sourcePath: "/links",
				sourceRelativePath: "links",
				wpPostId: "437",
			}),
		).toMatchObject({
			status: "verified",
			confidence: 85,
		});
	});

	it("verifies URL-only sitemap entries by canonical path", () => {
		expect(
			verifyDistTarget({
				targetDistRoot: `
					<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
						<url><loc>https://x-item.com/termux.html</loc></url>
					</urlset>
				`,
				targetPath: "termux.html",
				sourceTitle: "Termux",
				sourcePath: "/termux.html",
				sourceRelativePath: "termux.html",
				wpPostId: "1",
			}),
		).toMatchObject({
			status: "verified",
			confidence: 80,
			reasons: ["static_index_url_match"],
		});
	});

	it("uses RSS title entries as stronger static index evidence", () => {
		expect(
			verifyDistTarget({
				targetDistRoot: `
					<rss version="2.0">
						<channel>
							<item>
								<title>Termux</title>
								<link>https://x-item.com/termux.html</link>
							</item>
						</channel>
					</rss>
				`,
				targetPath: "termux.html",
				sourceTitle: "Termux",
				sourcePath: "/termux.html",
				sourceRelativePath: "termux.html",
				wpPostId: "1",
			}),
		).toMatchObject({
			status: "verified",
			confidence: 90,
			reasons: ["static_index_url_match", "static_index_title_match"],
		});
	});
});

describe("parseStaticSiteIndex", () => {
	it("parses sitemap and RSS entries", () => {
		expect(
			parseStaticSiteIndex(`
				<urlset><url><loc>https://x-item.com/sitemap-only.html</loc></url></urlset>
			`),
		).toEqual([
			{
				url: "https://x-item.com/sitemap-only.html",
			},
		]);
		expect(
			parseStaticSiteIndex(`
				<rss><channel><item><title><![CDATA[RSS Title]]></title><link><![CDATA[https://x-item.com/rss.html]]></link></item></channel></rss>
			`),
		).toEqual([
			{
				url: "https://x-item.com/rss.html",
				title: "RSS Title",
			},
		]);
	});

	it("parses sitemap index child URLs", () => {
		expect(
			parseSitemapIndexUrls(`
				<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
					<sitemap><loc>https://x-item.com/post-sitemap.xml</loc></sitemap>
					<sitemap><loc>https://x-item.com/page-sitemap.xml</loc></sitemap>
				</sitemapindex>
			`),
		).toEqual([
			"https://x-item.com/post-sitemap.xml",
			"https://x-item.com/page-sitemap.xml",
		]);
	});
});
