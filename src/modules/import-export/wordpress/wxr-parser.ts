import { XMLParser } from "fast-xml-parser";

import type { WxrAuthor, WxrComment, WxrDocument, WxrItem } from "./wxr-types";

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	textNodeName: "#text",
	cdataPropName: "#cdata",
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: true,
	isArray: (name) =>
		["item", "category", "wp:author", "wp:comment"].includes(name) ||
		name === "wp:postmeta",
});

function asArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) {
		return [];
	}
	return Array.isArray(value) ? value : [value];
}

function asNode(value: unknown): XmlNode {
	return typeof value === "object" && value !== null ? (value as XmlNode) : {};
}

function text(value: unknown): string {
	if (value === undefined || value === null) {
		return "";
	}
	if (typeof value === "string" || typeof value === "number") {
		return String(value);
	}
	const node = asNode(value);
	const cdata = node["#cdata"];
	if (typeof cdata === "string") {
		return cdata;
	}
	const textValue = node["#text"];
	return typeof textValue === "string" ? textValue : "";
}

function parseCategories(item: XmlNode): string[] {
	return asArray(item.category)
		.map((category) => asNode(category))
		.filter((category) => text(category["@_domain"]) === "category")
		.map((category) => text(category))
		.filter(Boolean);
}

function parseAuthors(channel: XmlNode): WxrAuthor[] {
	return asArray(channel["wp:author"]).map((authorValue) => {
		const author = asNode(authorValue);
		return {
			id: text(author["wp:author_id"]),
			login: text(author["wp:author_login"]),
			email: text(author["wp:author_email"]),
			displayName: text(author["wp:author_display_name"]),
			firstName: text(author["wp:author_first_name"]),
			lastName: text(author["wp:author_last_name"]),
		};
	});
}

function parseComments(item: XmlNode): WxrComment[] {
	return asArray(item["wp:comment"]).map((commentValue) => {
		const comment = asNode(commentValue);
		const parentId = text(comment["wp:comment_parent"]);
		return {
			commentId: text(comment["wp:comment_id"]),
			parentId: parentId && parentId !== "0" ? parentId : null,
			approved: text(comment["wp:comment_approved"]),
			type: text(comment["wp:comment_type"]),
			authorName: text(comment["wp:comment_author"]),
			authorEmail: text(comment["wp:comment_author_email"]) || undefined,
			commentUserId: text(comment["wp:comment_user_id"]) || undefined,
			authorUrl: text(comment["wp:comment_author_url"]) || undefined,
			authorIp: text(comment["wp:comment_author_IP"]) || undefined,
			userAgent: text(comment["wp:comment_agent"]) || undefined,
			date: text(comment["wp:comment_date"]) || undefined,
			dateGmt: text(comment["wp:comment_date_gmt"]) || undefined,
			content: text(comment["wp:comment_content"]),
		};
	});
}

export function parseWxr(xml: string): WxrDocument {
	const parsed = asNode(parser.parse(xml));
	const rss = asNode(parsed.rss);
	const channel = asNode(rss.channel);
	const rawItems = asArray(channel.item);
	const items: WxrItem[] = [];

	for (const itemValue of rawItems) {
		const item = asNode(itemValue);
		const postType = text(item["wp:post_type"]);
		if (postType !== "post" && postType !== "page") {
			continue;
		}
		items.push({
			wpPostId: text(item["wp:post_id"]),
			postType,
			title: text(item.title),
			link: text(item.link),
			postName: text(item["wp:post_name"]),
			postDate: text(item["wp:post_date"]) || undefined,
			postDateGmt: text(item["wp:post_date_gmt"]) || undefined,
			categories: parseCategories(item),
			comments: parseComments(item),
		});
	}

	return {
		metadata: {
			title: text(channel.title) || undefined,
			link: text(channel.link) || undefined,
			baseSiteUrl: text(channel["wp:base_site_url"]) || undefined,
			baseBlogUrl: text(channel["wp:base_blog_url"]) || undefined,
			version: text(channel["wp:wxr_version"]) || undefined,
		},
		authors: parseAuthors(channel),
		items,
	};
}
