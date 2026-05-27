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
	commentUserId?: string;
	author?: string;
	authorEmail?: string;
	content?: string;
}): string {
	return `<item>
  <title>${input.title}</title>
  <link>${input.link}</link>
  <wp:post_id>${input.id}</wp:post_id>
  <wp:post_type>post</wp:post_type>
  <wp:post_name>${input.id}</wp:post_name>
  <wp:comment>
    <wp:comment_id>${input.commentId ?? "1"}</wp:comment_id>
    <wp:comment_author>${input.author ?? "Alice"}</wp:comment_author>
    <wp:comment_author_email>${input.authorEmail ?? ""}</wp:comment_author_email>
    <wp:comment_content><![CDATA[${input.content ?? "hello"}]]></wp:comment_content>
    <wp:comment_approved>1</wp:comment_approved>
    <wp:comment_type></wp:comment_type>
    <wp:comment_parent>${input.parentId ?? "0"}</wp:comment_parent>
    <wp:comment_user_id>${input.commentUserId ?? "0"}</wp:comment_user_id>
  </wp:comment>
</item>`;
}

function wxrAuthor(): string {
	return `<wp:author>
  <wp:author_id>1</wp:author_id>
  <wp:author_login>Virace</wp:author_login>
  <wp:author_email>Virace@aliyun.com</wp:author_email>
  <wp:author_display_name>管理员</wp:author_display_name>
</wp:author>`;
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

	it("treats explicitly confirmed mappings as ready even when static index evidence is missing", () => {
		const report = analyzeWordPressComments({
			xml: wxrWithItems(
				`${wxrItem({
					id: "437",
					title: "友情链接",
					link: "https://x-item.com/links",
				})}${wxrItem({
					id: "1495",
					title: "留言板",
					link: "https://x-item.com/guestbook",
					commentId: "2",
				})}`,
			),
			fileName: "fixture.xml",
			siteKey: "fangyuan",
			sourceBasePath: "/",
			targetDistRoot: `
				<rss version="2.0">
					<channel>
						<item>
							<title>Other</title>
							<link>https://x-item.com/other/</link>
						</item>
					</channel>
				</rss>
			`,
			mapping: {
				items: [
					{
						wpPostId: "437",
						decision: "map",
						target: { pageKey: "links", pageUrl: "/links/" },
					},
					{
						wpPostId: "1495",
						decision: "map",
						target: { pageKey: "guestbook", pageUrl: "/guestbook/" },
					},
				],
			},
		});

		expect(report.items.map((item) => item.state)).toEqual(["ready", "ready"]);
		expect(report.items.map((item) => item.target)).toEqual([
			expect.objectContaining({
				pageKey: "links",
				pageUrl: "/links/",
				confidence: 100,
				source: "explicit_mapping",
			}),
			expect.objectContaining({
				pageKey: "guestbook",
				pageUrl: "/guestbook/",
				confidence: 100,
				source: "explicit_mapping",
			}),
		]);
		expect(report.summary.ready).toBe(2);
	});

	it("matches existing site pages by stored page URL and title", () => {
		const report = analyzeWordPressComments({
			xml: wxrWithItems(
				`${wxrItem({
					id: "1",
					title: "Existing Termux",
					link: "https://x-item.com/termux.html",
				})}${wxrItem({
					id: "2",
					title: "Title Only",
					link: "https://x-item.com/title-only.html",
					commentId: "2",
				})}`,
			),
			fileName: "fixture.xml",
			siteKey: "fangyuan",
			sourceBasePath: "/",
			existingPages: [
				{
					pageKey: "posts/termux/",
					pageTitle: "Different Title",
					pageUrl: "https://x-item.com/termux.html",
				},
				{
					pageKey: "posts/title-only/",
					pageTitle: "Title Only",
					pageUrl: "https://x-item.com/another-url/",
				},
			],
		});

		expect(report.items).toHaveLength(2);
		expect(report.items.map((item) => item.state)).toEqual(["ready", "ready"]);
		expect(report.items.map((item) => item.target)).toEqual([
			expect.objectContaining({
				pageKey: "posts/termux/",
				pageUrl: "https://x-item.com/termux.html",
				confidence: 95,
				source: "metadata",
			}),
			expect.objectContaining({
				pageKey: "posts/title-only/",
				pageUrl: "https://x-item.com/another-url/",
				confidence: 95,
				source: "metadata",
			}),
		]);
		expect(report.summary.ready).toBe(2);
	});

	it("uses an existing page match even when the page key strategy requires explicit mapping", () => {
		const report = analyzeWordPressComments({
			xml: wxrWithItems(
				wxrItem({
					id: "1",
					title: "Explicit Only",
					link: "https://x-item.com/explicit-only.html",
				}),
			),
			fileName: "fixture.xml",
			siteKey: "fangyuan",
			pageKeyStrategy: "explicit_only",
			existingPages: [
				{
					pageKey: "posts/explicit-only/",
					pageTitle: "Explicit Only",
					pageUrl: "https://x-item.com/explicit-only.html",
				},
			],
		});

		expect(report.items[0]).toMatchObject({
			state: "ready",
			target: {
				pageKey: "posts/explicit-only/",
				source: "metadata",
			},
		});
	});

	it("summarizes WXR author matches and HTML-like comment content", () => {
		const report = analyzeWordPressComments({
			xml: wxrWithItems(
				`${wxrAuthor()}${wxrItem({
					id: "1",
					title: "Strong",
					link: "https://x-item.com/strong.html",
					commentId: "1",
					commentUserId: "1",
					author: "Virace",
					authorEmail: "Virace@aliyun.com",
					content: '管理员 <a href="https://example.com">链接</a>',
				})}${wxrItem({
					id: "2",
					title: "Candidate",
					link: "https://x-item.com/candidate.html",
					commentId: "2",
					author: "Virace",
					authorEmail: "virace@ALIYUN.com",
				})}${wxrItem({
					id: "3",
					title: "Visitor",
					link: "https://x-item.com/visitor.html",
					commentId: "3",
					author: "Alice",
					authorEmail: "alice@example.com",
				})}`,
			),
			fileName: "fixture.xml",
			siteKey: "fangyuan",
			mapping: {
				items: [
					{
						wpPostId: "1",
						decision: "map",
						target: { pageKey: "strong.html", pageUrl: "/strong.html" },
					},
					{
						wpPostId: "2",
						decision: "map",
						target: {
							pageKey: "candidate.html",
							pageUrl: "/candidate.html",
						},
					},
					{
						wpPostId: "3",
						decision: "map",
						target: { pageKey: "visitor.html", pageUrl: "/visitor.html" },
					},
				],
			},
		});

		expect(report.authorSummary).toMatchObject({
			totalAuthors: 1,
			staffStrong: 1,
			staffEmailCandidate: 1,
			registeredUnknown: 0,
			visitor: 1,
		});
		expect(report.htmlContentSummary).toMatchObject({
			htmlLikeComments: 1,
		});
		expect(
			report.items.flatMap((item) =>
				item.comments.map((comment) => comment.authorMatch?.kind),
			),
		).toEqual(["staff_strong", "staff_email_candidate", "visitor"]);
	});
});
