import type { FastifyRequest } from "fastify";

import { AppError, ResourceNotFoundError } from "./errors";
import { normalizePagePath } from "./page-url";
import type { RegisteredSiteRecord, SiteRegistry } from "./site-registry";

export interface PublicPageContext {
	site: RegisteredSiteRecord;
	siteKey: string;
	pageKey: string;
	pageUrl: string;
	pageTitle?: string;
}

function readReferer(request: FastifyRequest): string | undefined {
	const header = request.headers.referer ?? request.headers.referrer;
	return typeof header === "string" && header.length > 0 ? header : undefined;
}

function derivePageKey(pageUrl: string): string {
	if (pageUrl === "/") {
		return "/";
	}

	return pageUrl.replace(/^\/+/, "");
}

function parseReferer(value: string): URL {
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error("Invalid referer protocol");
		}
		return parsed;
	} catch {
		throw new AppError(400, "PUBLIC_REFERER_INVALID", "公开请求来源页面无效。");
	}
}

export function resolvePublicPageContext(input: {
	siteRegistry: SiteRegistry;
	request: FastifyRequest;
	siteKey: string;
	pageTitle?: string;
}): PublicPageContext {
	const site = input.siteRegistry.getRegisteredSite(input.siteKey);
	if (!site) {
		throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
	}

	const referer = readReferer(input.request);
	if (!referer) {
		throw new AppError(
			403,
			"PUBLIC_REFERER_REQUIRED",
			"公开请求需要来源页面信息。",
		);
	}

	const parsedReferer = parseReferer(referer);
	if (!site.allowedOrigins.includes(parsedReferer.origin)) {
		throw new AppError(
			403,
			"PUBLIC_REFERER_FORBIDDEN",
			"请求来源页面不在站点允许列表中。",
		);
	}

	const pageUrl = normalizePagePath(parsedReferer.toString());
	if (!pageUrl) {
		throw new AppError(400, "PUBLIC_REFERER_INVALID", "公开请求来源页面无效。");
	}

	return {
		site,
		siteKey: site.siteKey,
		pageKey: derivePageKey(pageUrl),
		pageUrl,
		pageTitle: input.pageTitle,
	};
}
