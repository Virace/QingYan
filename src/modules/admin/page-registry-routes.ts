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

export const adminPageRegistryRoutes: FastifyPluginAsync = async (fastify) => {
	const repository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		repository,
		fastify.adminBootstrap,
	);
	const service = new PageRegistryService(fastify.db);

	fastify.get("/pending", async (request) => {
		await sessionService.requireSession(request);
		const parsed = adminPendingPagesQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		const result = await service.listPendingCandidates(parsed.data);
		return {
			items: result.items,
			pagination: {
				limit: parsed.data.limit,
				offset: parsed.data.offset,
				totalCount: result.totalCount,
			},
		};
	});

	fastify.post("/pending/approve", async (request) => {
		await sessionService.requireSession(request);
		const parsed = adminPendingPageApproveBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		const site = await repository.getSiteByKey(parsed.data.siteKey);
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const page = await service.approvePendingCandidate({
			siteId: site.id,
			siteKey: parsed.data.siteKey,
			pageKey: parsed.data.pageKey,
		});

		return {
			page,
		};
	});

	fastify.post("/pending/reject", async (request) => {
		await sessionService.requireSession(request);
		const parsed = adminPendingPageDecisionBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return {
			candidate: await service.rejectPendingCandidate(parsed.data),
		};
	});

	fastify.post("/pending/ignore", async (request) => {
		await sessionService.requireSession(request);
		const parsed = adminPendingPageDecisionBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		const site = await repository.getSiteByKey(parsed.data.siteKey);
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		return service.ignorePendingCandidate({
			siteId: site.id,
			...parsed.data,
		});
	});
};
