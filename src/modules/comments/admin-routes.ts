import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError } from "../shared/errors";
import { AdminManagementService } from "../admin/management-service";
import { AdminRepository } from "../admin/repository";
import {
	adminCommentBulkTrashBodySchema,
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
		await sessionService.requireSession(request);
		const parsed = adminCommentsQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return service.listComments(parsed.data);
	});

	fastify.post("/bulk-trash", async (request) => {
		await sessionService.requireSession(request);
		const parsedBody = adminCommentBulkTrashBodySchema.safeParse(request.body);
		if (!parsedBody.success) {
			throw new InvalidRequestError({
				issues: parsedBody.error.issues,
			});
		}

		return service.moveCommentsToTrash({
			commentIds: parsedBody.data.commentIds,
			requestId: request.context?.requestId,
		});
	});

	fastify.post("/trash/clear", async (request) => {
		await sessionService.requireSession(request);
		const parsedBody = adminCommentClearTrashBodySchema.safeParse(request.body);
		if (!parsedBody.success) {
			throw new InvalidRequestError({
				issues: parsedBody.error.issues,
			});
		}

		return service.clearTrash({
			siteKey: parsedBody.data.siteKey,
			requestId: request.context?.requestId,
		});
	});

	fastify.patch("/:commentId", async (request) => {
		await sessionService.requireSession(request);
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

		return {
			comment: await service.updateComment(parsedParams.data.commentId, {
				...parsedBody.data,
				requestId: request.context?.requestId,
			}),
		};
	});

	fastify.post("/:commentId/reply", async (request) => {
		await sessionService.requireSession(request);
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

		return service.replyToComment(parsedParams.data.commentId, {
			contentRaw: parsedBody.data.content.raw,
			requestId: request.context?.requestId,
		});
	});

	fastify.post("/:commentId/metadata/refresh", async (request) => {
		await sessionService.requireSession(request);
		const parsedParams = adminCommentParamsSchema.safeParse(request.params);
		if (!parsedParams.success) {
			throw new InvalidRequestError({
				issues: parsedParams.error.issues,
			});
		}

		return {
			metadata: await service.refreshCommentMetadata(
				parsedParams.data.commentId,
				request.context?.requestId,
			),
		};
	});

	fastify.delete("/:commentId", async (request) => {
		await sessionService.requireSession(request);
		const parsed = adminCommentParamsSchema.safeParse(request.params);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return {
			comment: await service.deleteComment(
				parsed.data.commentId,
				request.context?.requestId,
			),
		};
	});
};
