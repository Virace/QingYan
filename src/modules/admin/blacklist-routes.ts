import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError } from "../shared/errors";
import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import {
	adminBlacklistBodySchema,
	adminBlacklistParamsSchema,
	adminBlacklistQuerySchema,
	adminBlacklistTargetBodySchema,
} from "./schemas";
import { AdminSessionService } from "./session-service";
import {
	requirePermission,
	requireSiteAccess,
	requireSiteIdAccess,
} from "./authorization";

export const adminBlacklistRoutes: FastifyPluginAsync = async (fastify) => {
	const repository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		repository,
		fastify.adminBootstrap,
	);
	const service = new AdminManagementService(
		fastify.security,
		fastify.siteRegistry,
		repository,
	);

	fastify.get("/", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = adminBlacklistQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.data.siteKey,
			permission: "blacklist.read",
		});
		return service.listBlacklist(parsed.data);
	});

	fastify.post("/", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = adminBlacklistBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.data.siteKey,
			permission: "blacklist.create",
		});
		return {
			rule: await service.createBlacklist({
				...parsed.data,
				requestId: request.context?.requestId,
				actorUserId: session.user.id,
			}),
		};
	});

	fastify.delete("/target", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = adminBlacklistTargetBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.data.siteKey,
			permission: "blacklist.delete",
		});
		return {
			rules: await service.deleteBlacklistTarget({
				...parsed.data,
				requestId: request.context?.requestId,
				actorUserId: session.user.id,
			}),
		};
	});

	fastify.delete("/:ruleId", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "blacklist.delete");
		const parsed = adminBlacklistParamsSchema.safeParse(request.params);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		const rule = await repository.getBlacklistRule(parsed.data.ruleId);
		requireSiteIdAccess({
			session,
			siteId: rule?.siteId,
		});
		return {
			rule: await service.deleteBlacklist({
				ruleId: parsed.data.ruleId,
				requestId: request.context?.requestId,
				actorUserId: session.user.id,
			}),
		};
	});
};
