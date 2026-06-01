import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError, ValidationFailedError } from "../shared/errors";
import {
	adminUserCreateBodySchema,
	adminUserParamsSchema,
	adminUserPatchBodySchema,
	adminUserRevokeSessionsBodySchema,
	adminUserResetPasswordBodySchema,
	adminUsersQuerySchema,
} from "./schemas";
import { AdminRepository } from "./repository";
import { AdminSessionService } from "./session-service";
import { AdminUsersService } from "./admin-users-service";
import { requirePermission } from "./authorization";
import { toValidationFields } from "./validation-fields";

export const adminUsersRoutes: FastifyPluginAsync = async (fastify) => {
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		new AdminRepository(fastify.db),
		fastify.adminBootstrap,
		fastify.siteRegistry,
	);
	const service = new AdminUsersService(fastify.db, fastify.security);

	fastify.get("/users", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "users.read");
		const parsed = adminUsersQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		return service.listUsers(parsed.data);
	});

	fastify.post("/users", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "users.create");
		const parsed = adminUserCreateBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new ValidationFailedError(
				toValidationFields(parsed.error.issues, request.body),
			);
		}
		return service.createUser({
			session,
			...parsed.data,
		});
	});

	fastify.patch("/users/:userId", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "users.update");
		const parsedParams = adminUserParamsSchema.safeParse(request.params);
		const parsedBody = adminUserPatchBodySchema.safeParse(request.body);
		if (!parsedParams.success) {
			throw new InvalidRequestError({
				issues: parsedParams.error.issues,
			});
		}
		if (!parsedBody.success) {
			throw new ValidationFailedError(
				toValidationFields(parsedBody.error.issues, request.body),
			);
		}
		return service.updateUser({
			session,
			userId: parsedParams.data.userId,
			...parsedBody.data,
		});
	});

	fastify.post("/users/:userId/reset-password", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "users.reset_password");
		const parsedParams = adminUserParamsSchema.safeParse(request.params);
		const parsedBody = adminUserResetPasswordBodySchema.safeParse(request.body);
		if (!parsedParams.success) {
			throw new InvalidRequestError({
				issues: parsedParams.error.issues,
			});
		}
		if (!parsedBody.success) {
			throw new ValidationFailedError(
				toValidationFields(parsedBody.error.issues, request.body),
			);
		}
		return service.resetPassword({
			session,
			userId: parsedParams.data.userId,
			...parsedBody.data,
		});
	});

	fastify.post("/users/:userId/revoke-sessions", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "users.update");
		const parsedParams = adminUserParamsSchema.safeParse(request.params);
		const parsedBody = adminUserRevokeSessionsBodySchema.safeParse(
			request.body,
		);
		if (!parsedParams.success) {
			throw new InvalidRequestError({
				issues: parsedParams.error.issues,
			});
		}
		if (!parsedBody.success) {
			throw new ValidationFailedError(
				toValidationFields(parsedBody.error.issues, request.body),
			);
		}
		return service.revokeSessions({
			session,
			userId: parsedParams.data.userId,
			...parsedBody.data,
		});
	});

	fastify.delete("/users/:userId", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "users.delete");
		const parsedParams = adminUserParamsSchema.safeParse(request.params);
		if (!parsedParams.success) {
			throw new InvalidRequestError({
				issues: parsedParams.error.issues,
			});
		}
		return service.deleteUser({
			session,
			userId: parsedParams.data.userId,
		});
	});

	fastify.get("/groups", async (request) => {
		const session = await sessionService.requireSession(request);
		requirePermission(session, "groups.read");
		return service.listGroups();
	});
};
