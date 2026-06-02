import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { InvalidRequestError, ResourceNotFoundError } from "../shared/errors";
import { CommenterPreferencesRepository } from "./commenter-preferences-repository";
import { UnsubscribeTokenService } from "./unsubscribe-token-service";

const unsubscribeQuerySchema = z.object({
	token: z.string().min(1),
});

export const notificationsPublicRoutes: FastifyPluginAsync = async (
	fastify,
) => {
	const preferences = new CommenterPreferencesRepository(fastify.db);
	const tokens = new UnsubscribeTokenService(fastify.db, preferences);

	fastify.get("/unsubscribe", async (request) => {
		const parsed = unsubscribeQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({ issues: parsed.error.issues });
		}

		const result = await tokens.consume({
			token: parsed.data.token,
		});
		if (result.status !== "unsubscribed") {
			throw new ResourceNotFoundError(
				"UNSUBSCRIBE_TOKEN_INVALID",
				"退订链接无效或已失效。",
			);
		}

		return {
			status: "unsubscribed",
		};
	});
};
