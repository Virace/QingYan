import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError } from "../shared/errors";
import { AdminManagementService } from "../admin/management-service";
import { AdminRepository } from "../admin/repository";
import {
	requirePermission,
	requireSiteAccess,
	requireSiteIdAccess,
} from "../admin/authorization";
import {
	adminCommentBulkMetadataRefreshBodySchema,
	adminCommentBulkTrashBodySchema,
	adminCommentBulkUpdateBodySchema,
	adminCommentClearTrashBodySchema,
	adminCommentParamsSchema,
	adminCommentPatchBodySchema,
	adminCommentReplyBodySchema,
	adminCommentsQuerySchema,
} from "../admin/schemas";
import { AdminSessionService } from "../admin/session-service";

export const commentsAdminRoutes: FastifyPluginAsync = async (fastify) => {
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
		const parsed = adminCommentsQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.data.siteKey,
			permission: "comments.read",
		});
		return service.listComments(parsed.data);
	});

	fastify.post("/bulk-update", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedBody = adminCommentBulkUpdateBodySchema.safeParse(request.body);
		if (!parsedBody.success) {
			throw new InvalidRequestError({
				issues: parsedBody.error.issues,
			});
		}

		requirePermission(session, "comments.moderate");
		const targetComments = await repository.listCommentsByIds(
			parsedBody.data.commentIds,
		);
		for (const comment of targetComments) {
			requireSiteIdAccess({
				session,
				siteId: comment.siteId,
			});
		}
		return service.bulkUpdateComments({
			commentIds: parsedBody.data.commentIds,
			patch: parsedBody.data.patch,
			requestId: request.context?.requestId,
			actorUserId: session.user.id,
		});
	});

	fastify.post("/bulk-trash", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedBody = adminCommentBulkTrashBodySchema.safeParse(request.body);
		if (!parsedBody.success) {
			throw new InvalidRequestError({
				issues: parsedBody.error.issues,
			});
		}

		requirePermission(session, "comments.trash");
		const targetComments = await repository.listCommentsByIds(
			parsedBody.data.commentIds,
		);
		for (const comment of targetComments) {
			requireSiteIdAccess({
				session,
				siteId: comment.siteId,
			});
		}
		return service.moveCommentsToTrash({
			commentIds: parsedBody.data.commentIds,
			requestId: request.context?.requestId,
			actorUserId: session.user.id,
		});
	});

	fastify.post("/trash/clear", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedBody = adminCommentClearTrashBodySchema.safeParse(request.body);
		if (!parsedBody.success) {
			throw new InvalidRequestError({
				issues: parsedBody.error.issues,
			});
		}

		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsedBody.data.siteKey,
			permission: "comments.delete",
		});
		return service.clearTrash({
			siteKey: parsedBody.data.siteKey,
			requestId: request.context?.requestId,
			actorUserId: session.user.id,
		});
	});

	fastify.post("/metadata/refresh", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedBody = adminCommentBulkMetadataRefreshBodySchema.safeParse(
			request.body,
		);
		if (!parsedBody.success) {
			throw new InvalidRequestError({
				issues: parsedBody.error.issues,
			});
		}

		requirePermission(session, "comments.refresh_metadata");
		const targetComments = await repository.listCommentsByIds(
			parsedBody.data.commentIds,
		);
		for (const comment of targetComments) {
			requireSiteIdAccess({
				session,
				siteId: comment.siteId,
			});
		}
		return service.bulkRefreshCommentMetadata(
			parsedBody.data.commentIds,
			request.context?.requestId,
			session.user.id,
		);
	});

	fastify.patch("/:commentId", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedParams = adminCommentParamsSchema.safeParse(request.params);
		const parsedBody = adminCommentPatchBodySchema.safeParse(request.body);
		if (!parsedParams.success || !parsedBody.success) {
			throw new InvalidRequestError({
				issues: [
					...(parsedParams.success ? [] : parsedParams.error.issues),
					...(parsedBody.success ? [] : parsedBody.error.issues),
				],
			});
		}

		const comment = await repository.getCommentById(
			parsedParams.data.commentId,
		);
		requireSiteIdAccess({
			session,
			siteId: comment?.siteId,
			permission:
				parsedBody.data.status === "trash"
					? "comments.trash"
					: "comments.moderate",
		});
		return {
			comment: await service.updateComment(parsedParams.data.commentId, {
				...parsedBody.data,
				requestId: request.context?.requestId,
				actorUserId: session.user.id,
			}),
		};
	});

	fastify.post("/:commentId/reply", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedParams = adminCommentParamsSchema.safeParse(request.params);
		const parsedBody = adminCommentReplyBodySchema.safeParse(request.body);
		if (!parsedParams.success || !parsedBody.success) {
			throw new InvalidRequestError({
				issues: [
					...(parsedParams.success ? [] : parsedParams.error.issues),
					...(parsedBody.success ? [] : parsedBody.error.issues),
				],
			});
		}

		const comment = await repository.getCommentById(
			parsedParams.data.commentId,
		);
		requireSiteIdAccess({
			session,
			siteId: comment?.siteId,
			permission: "comments.reply",
		});
		return service.replyToComment(parsedParams.data.commentId, {
			contentRaw: parsedBody.data.content.raw,
			requestId: request.context?.requestId,
			actorUserId: session.user.id,
		});
	});

	fastify.post("/:commentId/metadata/refresh", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedParams = adminCommentParamsSchema.safeParse(request.params);
		if (!parsedParams.success) {
			throw new InvalidRequestError({
				issues: parsedParams.error.issues,
			});
		}

		const comment = await repository.getCommentById(
			parsedParams.data.commentId,
		);
		requireSiteIdAccess({
			session,
			siteId: comment?.siteId,
			permission: "comments.refresh_metadata",
		});
		return {
			metadata: await service.refreshCommentMetadata({
				commentId: parsedParams.data.commentId,
				requestId: request.context?.requestId,
				actorUserId: session.user.id,
			}),
		};
	});

	fastify.delete("/:commentId", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = adminCommentParamsSchema.safeParse(request.params);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		const comment = await repository.getCommentById(parsed.data.commentId);
		requireSiteIdAccess({
			session,
			siteId: comment?.siteId,
			permission: "comments.delete",
		});
		return {
			comment: await service.deleteComment({
				commentId: parsed.data.commentId,
				requestId: request.context?.requestId,
				actorUserId: session.user.id,
			}),
		};
	});
};
