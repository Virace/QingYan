import type { FastifyPluginAsync } from "fastify";

import { InvalidRequestError, ValidationFailedError } from "../shared/errors";
import { AdminRepository } from "./repository";
import {
	adminProfileEmailChangeBodySchema,
	adminProfileEmailChangeConfirmBodySchema,
	adminProfilePasswordBodySchema,
	adminProfilePatchBodySchema,
} from "./schemas";
import { AdminSessionService } from "./session-service";
import { AdminProfileService } from "./profile-service";
import { toValidationFields } from "./validation-fields";

export const adminProfileRoutes: FastifyPluginAsync = async (fastify) => {
	const repository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		repository,
		fastify.adminBootstrap,
		fastify.siteRegistry,
	);
	const service = new AdminProfileService(fastify.db, fastify.security);

	fastify.get("/", async (request) => {
		const session = await sessionService.requireSession(request, {
			allowPasswordChangeRequired: true,
		});
		return service.getProfile(session);
	});

	fastify.patch("/", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = adminProfilePatchBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new ValidationFailedError(
				toValidationFields(parsed.error.issues, request.body),
			);
		}
		return service.updateProfile({
			session,
			displayName: parsed.data.displayName,
			website: parsed.data.website,
			avatarUrl: parsed.data.avatarUrl,
		});
	});

	fastify.post("/password", async (request) => {
		const session = await sessionService.requireSession(request, {
			allowPasswordChangeRequired: true,
		});
		const parsed = adminProfilePasswordBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		return service.updatePassword({
			session,
			...parsed.data,
		});
	});

	fastify.post("/email-change", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = adminProfileEmailChangeBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new ValidationFailedError(
				toValidationFields(parsed.error.issues, request.body),
			);
		}
		return service.requestEmailChange({
			session,
			...parsed.data,
		});
	});

	fastify.post("/email-change/confirm", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsed = adminProfileEmailChangeConfirmBodySchema.safeParse(
			request.body,
		);
		if (!parsed.success) {
			throw new ValidationFailedError(
				toValidationFields(parsed.error.issues, request.body),
			);
		}
		return service.confirmEmailChange({
			session,
			token: parsed.data.token,
		});
	});
};
