import type { FastifyPluginAsync } from "fastify";
import { PageRegistryService } from "../page-registry/service";
import { PageMetadataRefreshService } from "../page-registry/title-refresh-service";
import { MaintenanceJobRepository } from "../ops/maintenance-job-repository";
import { AppError, InvalidRequestError } from "../shared/errors";
import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import { DeletionPolicyService } from "./deletion-policy-service";
import {
	adminPageKeyParamsSchema,
	adminPageLifecycleBodySchema,
	adminPageTitleRefreshBodySchema,
	adminPagesWithStatusQuerySchema,
} from "./schemas";
import { AdminSessionService } from "./session-service";
import { requireSiteAccess } from "./authorization";

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
	const deletionPolicyService = new DeletionPolicyService(fastify.db);
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
		const session = await sessionService.requireSession(request);
		const parsed = adminPagesWithStatusQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.data.siteKey,
			permission: "pages.read",
		});
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
			siteKey: parsedBody.data.siteKey,
		};
	}

	fastify.post("/:pageKey/trash", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = await parseLifecycleRequest(request);
		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.siteKey,
			permission: "pages.trash",
		});
		return {
			page: await pageRegistryService.trashPage(parsed),
		};
	});

	fastify.post("/:pageKey/restore", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = await parseLifecycleRequest(request);
		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.siteKey,
			permission: "pages.update",
		});
		return {
			page: await pageRegistryService.restorePage(parsed),
		};
	});

	fastify.post("/trash/clear", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedBody = adminPageLifecycleBodySchema.safeParse(request.body);
		if (!parsedBody.success) {
			throw new InvalidRequestError({
				issues: parsedBody.error.issues,
			});
		}
		const site = requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsedBody.data.siteKey,
			permission: "pages.trash_empty",
		});
		const result = await pageRegistryService.clearTrash({
			siteId: site?.id,
			siteKey: parsedBody.data.siteKey,
		});
		const pageKeys = result.pages.map((page) => page.pageKey);
		const deletion = await deletionPolicyService.requestDeletion({
			resourceType: "page_trash",
			resourceId: parsedBody.data.siteKey ?? "all",
			siteId: site?.id ?? null,
			actorUserId: session.user.id,
			metadata: {
				siteKey: parsedBody.data.siteKey,
				pageCount: result.deletedCount,
				pages: result.pages,
			},
			hardDelete: async () =>
				pageRegistryService.hardDeletePages({
					pageKeys,
					siteId: site?.id ?? null,
				}),
		});
		return {
			deletedCount: result.deletedCount,
			deletion: {
				mode: deletion.mode,
				resourceCount: result.deletedCount,
				hardDeleteAfter: deletion.record?.hardDeleteAfter,
			},
		};
	});

	fastify.post("/:pageKey/delete", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = await parseLifecycleRequest(request);
		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.siteKey,
			permission: "pages.delete",
		});
		const page = await pageRegistryService.deletePage(parsed);
		const deletion = await deletionPolicyService.requestDeletion({
			resourceType: "page",
			resourceId: parsed.pageKey,
			siteId: parsed.siteId ?? null,
			actorUserId: session.user.id,
			metadata: {
				siteKey: page.siteKey,
				pageKey: page.pageKey,
				pageUrl: page.pageUrl,
			},
			hardDelete: async () => 1,
		});
		return {
			page: {
				...page,
				deletion: {
					mode: deletion.mode,
					hardDeleteAfter: deletion.record?.hardDeleteAfter,
				},
			},
		};
	});

	fastify.post("/:pageKey/title/refresh", async (request) => {
		const session = await sessionService.requireSession(request);
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

		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsedBody.data.siteKey,
			permission: "pages.update",
		});
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
