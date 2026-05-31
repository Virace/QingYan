import type { FastifyPluginAsync } from "fastify";
import type { z } from "zod";

import { InvalidRequestError, ValidationFailedError } from "../shared/errors";
import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import {
	adminSettingsBodySchema,
	adminSiteCreateBodySchema,
	adminSiteParamsSchema,
	adminSitePatchBodySchema,
} from "./schemas";
import { AdminSessionService } from "./session-service";

function readPathValue(source: unknown, path: PropertyKey[]) {
	let value = source;
	for (const segment of path) {
		if (value === null || typeof value !== "object") {
			return undefined;
		}
		value = (value as Record<PropertyKey, unknown>)[segment];
	}
	return value;
}

function describeReceived(value: unknown): string {
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return "array";
	}
	return typeof value;
}

function toValidationFields(issues: z.core.$ZodIssue[], source: unknown) {
	return issues.map((issue) => {
		const path = issue.path.join(".");
		const expected = "expected" in issue ? String(issue.expected) : undefined;
		return {
			path,
			code: issue.code,
			expected,
			received: describeReceived(readPathValue(source, issue.path)),
			message:
				issue.code === "invalid_type" && expected === "boolean"
					? "必须是 JSON boolean，不能使用 0/1。"
					: issue.message,
		};
	});
}

export const adminSitesRoutes: FastifyPluginAsync = async (fastify) => {
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
		return service.listSitesSummary();
	});

	fastify.post("/", async (request) => {
		await sessionService.requireSession(request);
		const parsed = adminSiteCreateBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return service.createSite({
			...parsed.data,
			requestId: request.context?.requestId,
		});
	});

	fastify.patch("/:siteKey", async (request) => {
		await sessionService.requireSession(request);
		const parsedParams = adminSiteParamsSchema.safeParse(request.params);
		const parsedBody = adminSitePatchBodySchema.safeParse(request.body);
		if (!parsedParams.success || !parsedBody.success) {
			throw new InvalidRequestError({
				issues: [
					...(parsedParams.success ? [] : parsedParams.error.issues),
					...(parsedBody.success ? [] : parsedBody.error.issues),
				],
			});
		}

		return service.updateSite({
			siteKey: parsedParams.data.siteKey,
			...parsedBody.data,
			requestId: request.context?.requestId,
		});
	});

	fastify.get("/:siteKey/settings", async (request) => {
		await sessionService.requireSession(request);
		const parsedParams = adminSiteParamsSchema.safeParse(request.params);
		if (!parsedParams.success) {
			throw new InvalidRequestError({
				issues: parsedParams.error.issues,
			});
		}

		return service.getSettings(parsedParams.data.siteKey);
	});

	fastify.put("/:siteKey/settings", async (request) => {
		await sessionService.requireSession(request);
		const parsedParams = adminSiteParamsSchema.safeParse(request.params);
		const parsedBody = adminSettingsBodySchema.safeParse(request.body);
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

		return service.updateSettings(parsedParams.data.siteKey, {
			...parsedBody.data,
			requestId: request.context?.requestId,
		});
	});
};
