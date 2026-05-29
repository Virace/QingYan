import type { FastifyPluginAsync } from "fastify";
import { PageRegistryService } from "../page-registry/service";
import { PageMetadataRefreshService } from "../page-registry/title-refresh-service";
import { MaintenanceJobRepository } from "../ops/maintenance-job-repository";
import { AppError, InvalidRequestError } from "../shared/errors";
import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import {
	adminPageKeyParamsSchema,
	adminPageLifecycleBodySchema,
	adminPageTitleRefreshBodySchema,
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
	const titleRefresh = new PageMetadataRefreshService(
		fastify.db,
		new MaintenanceJobRepository(fastify.db),
		{
			fetchHtml:
				fastify.pageTitleFetchHtml ??
				(async (url, options) => {
					const controller = new AbortController();
					const timeout = setTimeout(
						() => controller.abort(),
						options.timeoutMs,
					);
					try {
						const response = await fetch(url, { signal: controller.signal });
						const text = await response.text();
						if (new TextEncoder().encode(text).byteLength > options.maxBytes) {
							throw new AppError(
								413,
								"PAGE_TITLE_HTML_TOO_LARGE",
								"页面 HTML 内容超过大小限制。",
							);
						}
						return { status: response.status, text };
					} finally {
						clearTimeout(timeout);
					}
				}),
		},
	);

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

	fastify.post("/:pageKey/title/refresh", async (request) => {
		await sessionService.requireSession(request);
		const parsedParams = adminPageKeyParamsSchema.safeParse(request.params);
		const parsedBody = adminPageTitleRefreshBodySchema.safeParse(request.body);
		if (!parsedParams.success || !parsedBody.success) {
			throw new InvalidRequestError({
				issues: [
					...(parsedParams.success ? [] : parsedParams.error.issues),
					...(parsedBody.success ? [] : parsedBody.error.issues),
				],
			});
		}

		const job = await titleRefresh.createRefreshJob({
			siteKey: parsedBody.data.siteKey,
			pageKeys: [parsedParams.data.pageKey],
			forceTitle: true,
			trigger: "manual",
			runAfter: parsedBody.data.runAfter ?? null,
			maxAttempts: parsedBody.data.maxAttempts,
			retryDelaySec: parsedBody.data.retryDelaySec,
		});
		void titleRefresh.runNextQueuedJob();
		return {
			job: {
				...job,
				siteKey: parsedBody.data.siteKey,
			},
		};
	});
};
