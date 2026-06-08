import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError } from "../shared/errors";
import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import {
	adminAllowlistBodySchema,
	adminAllowlistParamsSchema,
	adminAllowlistPatchBodySchema,
	adminAllowlistQuerySchema,
} from "./schemas";
import { AdminSessionService } from "./session-service";
import { requireSiteAccess, requireSiteIdAccess } from "./authorization";

export const adminAllowlistRoutes: FastifyPluginAsync = async (fastify) => {
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
		const parsed = adminAllowlistQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.data.siteKey,
			permission: "allowlist.read",
		});
		return service.listAllowlist(parsed.data);
	});

	fastify.post("/", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = adminAllowlistBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.data.siteKey,
			permission: "allowlist.create",
		});
		return {
			rule: await service.createAllowlist({
				...parsed.data,
				requestId: request.context?.requestId,
				actorUserId: session.user.id,
			}),
		};
	});

	fastify.patch("/:ruleId", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedParams = adminAllowlistParamsSchema.safeParse(request.params);
		if (!parsedParams.success) {
			throw new InvalidRequestError({
				issues: parsedParams.error.issues,
			});
		}
		const parsedBody = adminAllowlistPatchBodySchema.safeParse(request.body);
		if (!parsedBody.success) {
			throw new InvalidRequestError({
				issues: parsedBody.error.issues,
			});
		}

		const rule = await repository.getAllowlistRule(parsedParams.data.ruleId);
		requireSiteIdAccess({
			session,
			siteId: rule?.siteId,
			permission: "allowlist.update",
		});
		return {
			rule: await service.updateAllowlist({
				ruleId: parsedParams.data.ruleId,
				...parsedBody.data,
				requestId: request.context?.requestId,
				actorUserId: session.user.id,
			}),
		};
	});

	fastify.delete("/:ruleId", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = adminAllowlistParamsSchema.safeParse(request.params);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		const rule = await repository.getAllowlistRule(parsed.data.ruleId);
		requireSiteIdAccess({
			session,
			siteId: rule?.siteId,
			permission: "allowlist.delete",
		});
		return {
			rule: await service.deleteAllowlist({
				ruleId: parsed.data.ruleId,
				requestId: request.context?.requestId,
				actorUserId: session.user.id,
			}),
		};
	});
};
