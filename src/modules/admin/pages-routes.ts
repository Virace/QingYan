import type { FastifyPluginAsync } from "fastify";
import { PageRegistryService } from "../page-registry/service";
import { InvalidRequestError } from "../shared/errors";
import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import {
	adminPageKeyParamsSchema,
	adminPageLifecycleBodySchema,
	adminPagesWithStatusQuerySchema,
} from "./schemas";
import { AdminSessionService } from "./session-service";

export const adminPagesRoutes: FastifyPluginAsync = async (fastify) => {
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
	const pageRegistryService = new PageRegistryService(fastify.db);

	fastify.get("/", async (request) => {
		await sessionService.requireSession(request);
		const parsed = adminPagesWithStatusQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return service.listPages(parsed.data);
	});

	async function parseLifecycleRequest(request: {
		params: unknown;
		body: unknown;
	}) {
		const parsedParams = adminPageKeyParamsSchema.safeParse(request.params);
		const parsedBody = adminPageLifecycleBodySchema.safeParse(request.body);
		if (!parsedParams.success || !parsedBody.success) {
			throw new InvalidRequestError({
				issues: [
					...(parsedParams.success ? [] : parsedParams.error.issues),
					...(parsedBody.success ? [] : parsedBody.error.issues),
				],
			});
		}
		const site = parsedBody.data.siteKey
			? await repository.getSiteByKey(parsedBody.data.siteKey)
			: undefined;
		return {
			pageKey: parsedParams.data.pageKey,
			siteId: site?.id,
			siteKey: site?.siteKey,
		};
	}

	fastify.post("/:pageKey/trash", async (request) => {
		await sessionService.requireSession(request);
		const parsed = await parseLifecycleRequest(request);
		return {
			page: await pageRegistryService.trashPage(parsed),
		};
	});

	fastify.post("/:pageKey/restore", async (request) => {
		await sessionService.requireSession(request);
		const parsed = await parseLifecycleRequest(request);
		return {
			page: await pageRegistryService.restorePage(parsed),
		};
	});

	fastify.post("/:pageKey/delete", async (request) => {
		await sessionService.requireSession(request);
		const parsed = await parseLifecycleRequest(request);
		return {
			page: await pageRegistryService.deletePage(parsed),
		};
	});
};
