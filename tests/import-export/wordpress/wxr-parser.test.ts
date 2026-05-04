import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseWxr } from "../../../src/modules/import-export/wordpress/wxr-parser";

const fixture = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
  xmlns:wp="http://wordpress.org/export/1.2/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>x-item</title>
    <link>https://x-item.com</link>
    <wp:wxr_version>1.2</wp:wxr_version>
    <wp:base_site_url>https://x-item.com</wp:base_site_url>
    <wp:base_blog_url>https://x-item.com</wp:base_blog_url>
    <item>
      <title>Termux</title>
      <link>https://x-item.com/termux.html</link>
      <category domain="category"><![CDATA[技术]]></category>
      <category domain="post_format"><![CDATA[aside]]></category>
      <wp:post_id>123</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:post_name>termux</wp:post_name>
      <wp:post_date>2021-01-01 00:00:00</wp:post_date>
      <wp:comment>
        <wp:comment_id>1</wp:comment_id>
        <wp:comment_author>Alice</wp:comment_author>
        <wp:comment_author_email>a@example.com</wp:comment_author_email>
        <wp:comment_author_url>https://example.com</wp:comment_author_url>
        <wp:comment_author_IP>127.0.0.1</wp:comment_author_IP>
        <wp:comment_date>2021-01-02 00:00:00</wp:comment_date>
        <wp:comment_date_gmt>2021-01-01 16:00:00</wp:comment_date_gmt>
        <wp:comment_content><![CDATA[root]]></wp:comment_content>
        <wp:comment_approved>1</wp:comment_approved>
        <wp:comment_type></wp:comment_type>
        <wp:comment_parent>0</wp:comment_parent>
      </wp:comment>
      <wp:comment>
        <wp:comment_id>2</wp:comment_id>
        <wp:comment_author>Bob</wp:comment_author>
        <wp:comment_content><![CDATA[child]]></wp:comment_content>
        <wp:comment_approved>0</wp:comment_approved>
        <wp:comment_type>comment</wp:comment_type>
        <wp:comment_parent>1</wp:comment_parent>
      </wp:comment>
    </item>
  </channel>
</rss>`;

describe("parseWxr", () => {
	it("parses channel metadata, post items, categories, and nested comments", () => {
		const parsed = parseWxr(fixture);
		expect(parsed.metadata).toMatchObject({
			title: "x-item",
			baseBlogUrl: "https://x-item.com",
			version: "1.2",
		});
		expect(parsed.items).toHaveLength(1);
		expect(parsed.items[0]).toMatchObject({
			wpPostId: "123",
			postType: "post",
			title: "Termux",
			categories: ["技术"],
		});
		expect(parsed.items[0].comments).toHaveLength(2);
		expect(parsed.items[0].comments[1]).toMatchObject({
			commentId: "2",
			parentId: "1",
			approved: "0",
			type: "comment",
			content: "child",
		});
	});

	it("can smoke parse the local WXR fixture when present", () => {
		const filePath = "C:\\Users\\Virace\\Downloads\\WordPress.2026-04-19.xml";
		if (!existsSync(filePath)) {
			return;
		}

		const parsed = parseWxr(readFileSync(filePath, "utf-8"));
		expect(parsed.metadata.baseBlogUrl).toBeTruthy();
		expect(parsed.items.length).toBeGreaterThan(0);
	});
});
