import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildSuggestedMapping } from "../../../src/modules/import-export/report";
import { analyzeWordPressComments } from "../../../src/modules/import-export/wordpress/analyzer";

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

function wxrWithItems(items: string): string {
	return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>x-item</title>
    <link>https://x-item.com</link>
    <wp:wxr_version>1.2</wp:wxr_version>
    <wp:base_blog_url>https://x-item.com</wp:base_blog_url>
    ${items}
  </channel>
</rss>`;
}

function wxrItem(input: {
	id: string;
	title: string;
	link: string;
	commentId?: string;
	parentId?: string;
}): string {
	return `<item>
  <title>${input.title}</title>
  <link>${input.link}</link>
  <wp:post_id>${input.id}</wp:post_id>
  <wp:post_type>post</wp:post_type>
  <wp:post_name>${input.id}</wp:post_name>
  <wp:comment>
    <wp:comment_id>${input.commentId ?? "1"}</wp:comment_id>
    <wp:comment_author>Alice</wp:comment_author>
    <wp:comment_content>hello</wp:comment_content>
    <wp:comment_approved>1</wp:comment_approved>
    <wp:comment_type></wp:comment_type>
    <wp:comment_parent>${input.parentId ?? "0"}</wp:comment_parent>
  </wp:comment>
</item>`;
}

describe("analyzeWordPressComments", () => {
	it("builds report rows, source path examples, and summary counts", () => {
		const dist = createTempDist();
		writeFileSync(
			path.join(dist, "termux.html"),
			`<title>Termux</title><link rel="canonical" href="https://x-item.com/termux.html">`,
			"utf-8",
		);
		const report = analyzeWordPressComments({
			xml: wxrWithItems(
				`${wxrItem({
					id: "1",
					title: "Termux",
					link: "https://x-item.com/termux.html",
				})}${wxrItem({
					id: "2",
					title: "Missing",
					link: "https://x-item.com/missing.html",
					commentId: "2",
				})}`,
			),
			fileName: "fixture.xml",
			siteKey: "fangyuan",
			sourceBasePath: "/",
			targetDistRoot: dist,
			now: new Date("2026-05-04T00:00:00.000Z"),
		});

		expect(report.sourcePathExamples).toHaveLength(2);
		expect(report.items.map((item) => item.state)).toEqual([
			"ready",
			"needs_user_mapping",
		]);
		expect(report.summary).toMatchObject({
			totalItems: 2,
			ready: 1,
			needsUserMapping: 1,
			totalComments: 2,
		});
		expect(buildSuggestedMapping(report).items).toHaveLength(1);
	});

	it("detects duplicate target page keys as conflicts", () => {
		const dist = createTempDist();
		mkdirSync(path.join(dist, "same"), { recursive: true });
		writeFileSync(
			path.join(dist, "same", "index.html"),
			`<title>Same</title><link rel="canonical" href="https://x-item.com/same/">`,
			"utf-8",
		);

		const report = analyzeWordPressComments({
			xml: wxrWithItems(
				`${wxrItem({
					id: "1",
					title: "Same",
					link: "https://x-item.com/a/",
				})}${wxrItem({
					id: "2",
					title: "Same",
					link: "https://x-item.com/b/",
					commentId: "2",
				})}`,
			),
			fileName: "fixture.xml",
			siteKey: "fangyuan",
			targetDistRoot: dist,
			mapping: {
				items: [
					{
						wpPostId: "1",
						decision: "map",
						target: { pageKey: "same/", pageUrl: "/same/" },
					},
					{
						wpPostId: "2",
						decision: "map",
						target: { pageKey: "same/", pageUrl: "/same/" },
					},
				],
			},
		});

		expect(report.items.map((item) => item.state)).toEqual([
			"conflict",
			"conflict",
		]);
		expect(report.summary.conflict).toBe(2);
	});
});
