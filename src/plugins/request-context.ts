import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { resolveRequestId } from "../modules/shared/request-ids";
import { resolveVisitorIdentity } from "../modules/shared/visitor";

function readStringField(
	record: unknown,
	fieldName: "siteKey" | "pageKey",
): string | undefined {
	if (!record || typeof record !== "object") {
		return undefined;
	}

	const value = (record as Record<string, unknown>)[fieldName];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolveSiteKey(request: FastifyRequest): string | undefined {
	return (
		readStringField(request.params, "siteKey") ??
		readStringField(request.query, "siteKey") ??
		readStringField(request.body, "siteKey")
	);
}

function resolvePageKey(request: FastifyRequest): string | undefined {
	return (
		readStringField(request.params, "pageKey") ??
		readStringField(request.query, "pageKey") ??
		readStringField(request.body, "pageKey")
	);
}

const requestContextPlugin: FastifyPluginAsync = async (fastify) => {
	fastify.decorateRequest("context", undefined);

	fastify.addHook("onRequest", async (request) => {
		const headerName = fastify.config.security.requestIdHeader.toLowerCase();
		const existingHeader = request.headers[headerName];
		const requestId =
			typeof existingHeader === "string" ? existingHeader : undefined;
		const userAgentHeader = request.headers["user-agent"];

		request.context = {
			requestId: resolveRequestId(requestId),
			visitor: resolveVisitorIdentity(request),
			ip: request.ip,
			startedAt: Date.now(),
			userAgent:
				typeof userAgentHeader === "string" ? userAgentHeader : undefined,
		};
	});

	fastify.addHook("preHandler", async (request) => {
		if (!request.context) {
			return;
		}

		const siteKey = resolveSiteKey(request);
		const pageKey = resolvePageKey(request);
		request.context.siteKey = siteKey;
		request.context.pageKey = pageKey;
		request.context.site = fastify.siteRegistry.getConfiguredSite(siteKey);
	});
};

export default fp(requestContextPlugin, {
	name: "qingyan-request-context",
});
