import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError } from "../shared/errors";
import { AdminManagementService } from "../admin/management-service";
import { AdminRepository } from "../admin/repository";
import {
	adminCommentParamsSchema,
	adminCommentPatchBodySchema,
	adminCommentsQuerySchema,
} from "../admin/schemas";
import { AdminSessionService } from "../admin/session-service";

export const commentsAdminRoutes: FastifyPluginAsync = async (fastify) => {
	const repository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		repository,
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
