import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { resolveRequestId } from "../modules/shared/request-ids";
import { resolveVisitorIdentity } from "../modules/shared/visitor";

function readSiteKeyFromRecord(record: unknown): string | undefined {
	if (!record || typeof record !== "object") {
		return undefined;
	}

	const siteKey = (record as Record<string, unknown>).siteKey;
	return typeof siteKey === "string" && siteKey.length > 0
		? siteKey
		: undefined;
}

function resolveSiteKey(request: FastifyRequest): string | undefined {
	return (
		readSiteKeyFromRecord(request.params) ??
		readSiteKeyFromRecord(request.query) ??
		readSiteKeyFromRecord(request.body)
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
			userAgent:
				typeof userAgentHeader === "string" ? userAgentHeader : undefined,
		};
	});

	fastify.addHook("preHandler", async (request) => {
		if (!request.context) {
			return;
		}

		const siteKey = resolveSiteKey(request);
		request.context.siteKey = siteKey;
		request.context.site = fastify.siteRegistry.getConfiguredSite(siteKey);
	});
};

export default fp(requestContextPlugin, {
	name: "qingyan-request-context",
});
