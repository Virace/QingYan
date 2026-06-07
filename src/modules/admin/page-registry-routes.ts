import type { FastifyPluginAsync } from "fastify";

import { PageRegistryService } from "../page-registry/service";
import { InvalidRequestError, ResourceNotFoundError } from "../shared/errors";
import { AdminRepository } from "./repository";
import {
	adminPendingPageApproveBodySchema,
	adminPendingPageDecisionBodySchema,
	adminPendingPagesQuerySchema,
} from "./schemas";
import { AdminSessionService } from "./session-service";
import { requireSiteAccess } from "./authorization";

export const adminPageRegistryRoutes: FastifyPluginAsync = async (fastify) => {
	const repository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		repository,
		fastify.adminBootstrap,
	);
	const service = new PageRegistryService(fastify.db);

	function parseOrThrow<T>(
		result:
			| { success: true; data: T }
			| { success: false; error: { issues: unknown } },
	) {
		if (!result.success) {
			throw new InvalidRequestError({
				issues: result.error.issues,
			});
		}
		return result.data;
	}

	fastify.get("/pending", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPendingPagesQuerySchema.safeParse(request.query),
		);
		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.siteKey,
			permission: "page_registry.read",
		});

		const result = await service.listPendingCandidates(parsed);
		return {
			items: result.items,
			pagination: {
				limit: parsed.limit,
				offset: parsed.offset,
				totalCount: result.totalCount,
			},
		};
	});

	fastify.post("/pending/approve", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPendingPageApproveBodySchema.safeParse(request.body),
		);

		const site = requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.siteKey,
			permission: "page_registry.update",
		});
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const page = await service.approvePendingCandidate({
			siteId: site.id,
			siteKey: parsed.siteKey,
			pageKey: parsed.pageKey,
		});

		return {
			page,
		};
	});

	fastify.post("/pending/reject", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPendingPageDecisionBodySchema.safeParse(request.body),
		);
		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.siteKey,
			permission: "page_registry.update",
		});

		return {
			candidate: await service.rejectPendingCandidate(parsed),
		};
	});

	fastify.post("/pending/ignore", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPendingPageDecisionBodySchema.safeParse(request.body),
		);

		const site = requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.siteKey,
			permission: "page_registry.update",
		});
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		return service.ignorePendingCandidate({
			siteId: site.id,
			...parsed,
		});
	});
};
