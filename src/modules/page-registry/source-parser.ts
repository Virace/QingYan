import { XMLParser } from "fast-xml-parser";

export type PageSourceKind = "sitemap" | "rss" | "atom";

export interface PageSourceEntry {
	url: string;
	title?: string;
	sourceKind: PageSourceKind;
	warnings: string[];
}

export interface ParsedPageSource {
	entries: PageSourceEntry[];
	sitemapUrls: string[];
}

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	textNodeName: "#text",
	cdataPropName: "#cdata",
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: true,
	isArray: (name) => ["url", "sitemap", "item", "entry", "link"].includes(name),
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
	if (Array.isArray(value)) {
		return text(value[0]);
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

function parseSitemap(root: XmlNode): ParsedPageSource {
	const urlset = asNode(root.urlset);
	const sitemapIndex = asNode(root.sitemapindex);

	return {
		entries: asArray(urlset.url)
			.map((value) => text(asNode(value).loc))
			.filter(Boolean)
			.map((url) => ({ url, sourceKind: "sitemap", warnings: [] })),
		sitemapUrls: asArray(sitemapIndex.sitemap)
			.map((value) => text(asNode(value).loc))
			.filter(Boolean),
	};
}

function parseRss(root: XmlNode): ParsedPageSource {
	const rss = asNode(root.rss);
	const channel = asNode(rss.channel);

	return {
		entries: asArray(channel.item)
			.map((value) => asNode(value))
			.map((item) => ({
				url: text(item.link),
				title: text(item.title) || undefined,
				sourceKind: "rss" as const,
				warnings: [],
			}))
			.filter((entry) => entry.url),
		sitemapUrls: [],
	};
}

function atomLinkUrl(entry: XmlNode): string {
	for (const linkValue of asArray(entry.link)) {
		const link = asNode(linkValue);
		const rel = text(link["@_rel"]);
		if (!rel || rel === "alternate") {
			return text(link["@_href"]) || text(link);
		}
	}
	return "";
}

function parseAtom(root: XmlNode): ParsedPageSource {
	const feed = asNode(root.feed);

	return {
		entries: asArray(feed.entry)
			.map((value) => asNode(value))
			.map((entry) => ({
				url: atomLinkUrl(entry),
				title: text(entry.title) || undefined,
				sourceKind: "atom" as const,
				warnings: [],
			}))
			.filter((entry) => entry.url),
		sitemapUrls: [],
	};
}

export function parsePageSourceXml(
	xml: string,
	sourceKind: PageSourceKind,
): ParsedPageSource {
	const parsed = asNode(parser.parse(xml));
	if (sourceKind === "sitemap") {
		return parseSitemap(parsed);
	}
	if (sourceKind === "rss") {
		return parseRss(parsed);
	}
	return parseAtom(parsed);
}
