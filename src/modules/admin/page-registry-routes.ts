import type { FastifyPluginAsync } from "fastify";

import { PageRegistryService } from "../page-registry/service";
import { PageSourceRepository } from "../page-registry/source-repository";
import {
	AppError,
	InvalidRequestError,
	ResourceNotFoundError,
} from "../shared/errors";
import { AdminTaskService } from "../tasks/admin-task-service";
import { AdminRepository } from "./repository";
import {
	adminPageRegistryRefreshBodySchema,
	adminPageRegistrySourceCreateBodySchema,
	adminPageRegistrySourceDeleteBodySchema,
	adminPageRegistrySourceParamsSchema,
	adminPageRegistrySourcePatchBodySchema,
	adminPageRegistrySourceRefreshBodySchema,
	adminPageRegistrySourcesQuerySchema,
	adminPendingPageApproveBodySchema,
	adminPendingPageDecisionBodySchema,
	adminPendingPagesQuerySchema,
} from "./schemas";
import { AdminSessionService } from "./session-service";
import { requireSiteAccess, requireSiteIdAccess } from "./authorization";

export const adminPageRegistryRoutes: FastifyPluginAsync = async (fastify) => {
	const repository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		repository,
		fastify.adminBootstrap,
	);
	const service = new PageRegistryService(fastify.db);
	const sourceRepository = new PageSourceRepository(fastify.db);
	const adminTasks = new AdminTaskService(fastify.db, fastify.siteRegistry);

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

	function assertSourceUrlAllowed(sourceUrl: string, allowedOrigins: string[]) {
		const parsed = new URL(sourceUrl);
		if (!allowedOrigins.includes(parsed.origin)) {
			throw new AppError(
				400,
				"PAGE_SOURCE_ORIGIN_NOT_ALLOWED",
				"页面来源 URL 必须属于站点允许的 Origin。",
			);
		}
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

	fastify.get("/sources", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPageRegistrySourcesQuerySchema.safeParse(request.query),
		);
		const site = requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.siteKey,
			permission: "page_registry.read",
		});
		return {
			items: await sourceRepository.listSources({ siteId: site?.id }),
		};
	});

	fastify.post("/sources", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPageRegistrySourceCreateBodySchema.safeParse(request.body),
		);
		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.siteKey,
			permission: "page_registry.update",
		});
		const site = await repository.getSiteByKey(parsed.siteKey);
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}
		const allowedOrigins = JSON.parse(site.allowedOriginsJson) as string[];
		assertSourceUrlAllowed(parsed.sourceUrl, allowedOrigins);

		return {
			source: await sourceRepository.createSource({
				siteId: site.id,
				sourceType: parsed.sourceType,
				sourceUrl: parsed.sourceUrl,
				enabled: parsed.enabled,
				mode: parsed.mode,
				refreshIntervalSec: parsed.refreshIntervalSec ?? null,
			}),
		};
	});

	fastify.patch("/sources/:sourceId", async (request) => {
		const session = await sessionService.requireSession(request);
		const params = parseOrThrow(
			adminPageRegistrySourceParamsSchema.safeParse(request.params),
		);
		const patch = parseOrThrow(
			adminPageRegistrySourcePatchBodySchema.safeParse(request.body),
		);
		const source = await sourceRepository.getSource(params.sourceId);
		if (!source) {
			throw new ResourceNotFoundError(
				"PAGE_SOURCE_NOT_FOUND",
				"页面来源不存在。",
			);
		}
		requireSiteIdAccess({
			session,
			siteId: source.siteId,
			permission: "page_registry.update",
		});
		if (patch.sourceUrl) {
			const site = await repository.getSiteByKey(source.siteKey);
			const allowedOrigins = site
				? (JSON.parse(site.allowedOriginsJson) as string[])
				: [];
			assertSourceUrlAllowed(patch.sourceUrl, allowedOrigins);
		}
		return {
			source: await sourceRepository.updateSource({
				sourceId: params.sourceId,
				patch,
			}),
		};
	});

	fastify.delete("/sources/:sourceId", async (request) => {
		const session = await sessionService.requireSession(request);
		const params = parseOrThrow(
			adminPageRegistrySourceParamsSchema.safeParse(request.params),
		);
		parseOrThrow(
			adminPageRegistrySourceDeleteBodySchema.safeParse(request.body),
		);
		const source = await sourceRepository.getSource(params.sourceId);
		requireSiteIdAccess({
			session,
			siteId: source?.siteId,
			permission: "page_registry.update",
		});
		await sourceRepository.deleteSource(params.sourceId);
		return { ok: true };
	});

	fastify.post("/sources/:sourceId/refresh", async (request) => {
		const session = await sessionService.requireSession(request);
		const params = parseOrThrow(
			adminPageRegistrySourceParamsSchema.safeParse(request.params),
		);
		const body = parseOrThrow(
			adminPageRegistrySourceRefreshBodySchema.safeParse(request.body),
		);
		const source = await sourceRepository.getSource(params.sourceId);
		if (!source) {
			throw new ResourceNotFoundError(
				"PAGE_SOURCE_NOT_FOUND",
				"页面来源不存在。",
			);
		}
		requireSiteIdAccess({
			session,
			siteId: source.siteId,
			permission: "page_registry.update",
		});
		const run = await adminTasks.createManualRun(
			{
				type: "page_source_refresh",
				siteKey: source.siteKey,
				payload: {
					siteKey: source.siteKey,
					sourceIds: [source.id],
					trigger: "manual",
					timeoutMs: body?.timeoutMs,
					maxBytes: body?.maxBytes,
				},
				runAfter: body?.runAfter ?? null,
				maxAttempts: body?.maxAttempts,
				retryDelaySec: body?.retryDelaySec,
			},
			session,
			request.context?.requestId,
		);
		return { run };
	});

	fastify.post("/refresh", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPageRegistryRefreshBodySchema.safeParse(request.body),
		);
		if (!parsed) {
			throw new InvalidRequestError({
				issues: [{ path: ["siteKey"], message: "siteKey is required" }],
			});
		}
		const site = requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.siteKey,
			permission: "page_registry.update",
		});
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}
		const sources = await sourceRepository.listEnabledSources({
			siteId: site.id,
		});
		if (sources.length === 0) {
			throw new AppError(
				400,
				"PAGE_SOURCE_NOT_CONFIGURED",
				"没有可刷新的页面来源。",
			);
		}
		const run = await adminTasks.createManualRun(
			{
				type: "page_source_refresh",
				siteKey: parsed.siteKey,
				payload: {
					siteKey: parsed.siteKey,
					sourceIds: sources.map((source) => source.id),
					mode: parsed.mode,
					trigger: "manual",
					timeoutMs: parsed.timeoutMs,
					maxBytes: parsed.maxBytes,
				},
				runAfter: parsed.runAfter ?? null,
				maxAttempts: parsed.maxAttempts,
				retryDelaySec: parsed.retryDelaySec,
			},
			session,
			request.context?.requestId,
		);
		return { run };
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
