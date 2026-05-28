import type { FastifyPluginAsync } from "fastify";

import { PageRegistryService } from "../page-registry/service";
import { fetchPageSourceText } from "../page-registry/source-fetcher";
import { PageSourceRefreshService } from "../page-registry/source-refresh-service";
import { PageSourceRepository } from "../page-registry/source-repository";
import {
	AppError,
	InvalidRequestError,
	ResourceNotFoundError,
} from "../shared/errors";
import { MaintenanceJobRepository } from "../ops/maintenance-job-repository";
import { AdminRepository } from "./repository";
import {
	adminPageRegistryMaintenanceJobParamsSchema,
	adminPageRegistryRefreshBodySchema,
	adminPageRegistrySourceCreateBodySchema,
	adminPageRegistrySourceParamsSchema,
	adminPageRegistrySourcePatchBodySchema,
	adminPageRegistrySourcesQuerySchema,
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
	const sourceRepository = new PageSourceRepository(fastify.db);
	const maintenanceJobs = new MaintenanceJobRepository(fastify.db);
	const sourceRefresh = new PageSourceRefreshService(
		fastify.db,
		maintenanceJobs,
		{
			fetchText: fastify.pageSourceFetchText ?? fetchPageSourceText,
			loadAllowedOriginsForSite: async (siteKey) => {
				const site = await repository.getSiteByKey(siteKey);
				return site ? (JSON.parse(site.allowedOriginsJson) as string[]) : [];
			},
		},
	);

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
		await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPendingPagesQuerySchema.safeParse(request.query),
		);

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
		await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPageRegistrySourcesQuerySchema.safeParse(request.query),
		);
		return {
			items: await sourceRepository.listSources({ siteKey: parsed.siteKey }),
		};
	});

	fastify.post("/sources", async (request) => {
		await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPageRegistrySourceCreateBodySchema.safeParse(request.body),
		);
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
		await sessionService.requireSession(request);
		const params = parseOrThrow(
			adminPageRegistrySourceParamsSchema.safeParse(request.params),
		);
		const patch = parseOrThrow(
			adminPageRegistrySourcePatchBodySchema.safeParse(request.body),
		);
		if (patch.sourceUrl) {
			const source = await sourceRepository.getSource(params.sourceId);
			if (!source) {
				throw new ResourceNotFoundError(
					"PAGE_SOURCE_NOT_FOUND",
					"页面来源不存在。",
				);
			}
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
		await sessionService.requireSession(request);
		const params = parseOrThrow(
			adminPageRegistrySourceParamsSchema.safeParse(request.params),
		);
		await sourceRepository.deleteSource(params.sourceId);
		return { ok: true };
	});

	fastify.post("/sources/:sourceId/refresh", async (request) => {
		await sessionService.requireSession(request);
		const params = parseOrThrow(
			adminPageRegistrySourceParamsSchema.safeParse(request.params),
		);
		const source = await sourceRepository.getSource(params.sourceId);
		if (!source) {
			throw new ResourceNotFoundError(
				"PAGE_SOURCE_NOT_FOUND",
				"页面来源不存在。",
			);
		}
		const job = await sourceRefresh.createRefreshJob({
			siteKey: source.siteKey,
			sourceIds: [source.id],
			trigger: "manual",
		});
		void sourceRefresh.runNextQueuedJob();
		return { job };
	});

	fastify.post("/refresh", async (request) => {
		await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPageRegistryRefreshBodySchema.safeParse(request.body),
		);
		if (!parsed) {
			throw new InvalidRequestError({
				issues: [{ path: ["siteKey"], message: "siteKey is required" }],
			});
		}
		const job = await sourceRefresh.createRefreshJob({
			siteKey: parsed.siteKey,
			mode: parsed.mode,
			trigger: "manual",
		});
		void sourceRefresh.runNextQueuedJob();
		return { job };
	});

	fastify.get("/maintenance-jobs/:jobId", async (request) => {
		await sessionService.requireSession(request);
		const params = parseOrThrow(
			adminPageRegistryMaintenanceJobParamsSchema.safeParse(request.params),
		);
		return {
			job: await maintenanceJobs.get(params.jobId),
		};
	});

	fastify.post("/pending/approve", async (request) => {
		await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPendingPageApproveBodySchema.safeParse(request.body),
		);

		const site = await repository.getSiteByKey(parsed.siteKey);
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
		await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPendingPageDecisionBodySchema.safeParse(request.body),
		);

		return {
			candidate: await service.rejectPendingCandidate(parsed),
		};
	});

	fastify.post("/pending/ignore", async (request) => {
		await sessionService.requireSession(request);
		const parsed = parseOrThrow(
			adminPendingPageDecisionBodySchema.safeParse(request.body),
		);

		const site = await repository.getSiteByKey(parsed.siteKey);
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		return service.ignorePendingCandidate({
			siteId: site.id,
			...parsed,
		});
	});
};
