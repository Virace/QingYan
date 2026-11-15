import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
	emailPolicySchema,
	evaluateEmailPolicy,
	normalizedEmailSchema,
} from "../comments/email-policy";
import { mergeVerifiedAuthorSettings } from "../comments/verified-author";
import { ValidationFailedError } from "../shared/errors";
import { requireSiteAccess } from "./authorization";
import { AdminManagementService } from "./management-service";
import { AdminRepository } from "./repository";
import {
	adminSectionPatchBodySchema,
	adminSettingsBodySchema,
	adminSiteSettingsSectionParamsSchema,
} from "./schemas";
import { AdminSessionService } from "./session-service";
import { toValidationFields } from "./validation-fields";

type SiteSettingsUpdateInput = Parameters<
	AdminManagementService["updateSettings"]
>[1];

export const adminSettingsRoutes: FastifyPluginAsync = async (fastify) => {
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

	fastify.post("/:siteKey/email-policy/preview", async (request) => {
		const session = await sessionService.requireSession(request);
		const params = z
			.object({ siteKey: z.string().min(1) })
			.parse(request.params);
		const site = requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: params.siteKey,
			permission: "site_settings.update",
		});
		const parsed = z
			.object({
				email: normalizedEmailSchema,
				policy: emailPolicySchema,
				verifiedAuthorEmail: z
					.union([z.literal(""), normalizedEmailSchema])
					.optional(),
				identity: z.enum(["visitor", "current_account"]).default("visitor"),
			})
			.safeParse(request.body);
		if (!parsed.success)
			throw new ValidationFailedError(
				toValidationFields(parsed.error.issues, request.body),
			);
		if (!site)
			throw new ValidationFailedError([
				{ path: "siteKey", code: "invalid_value", message: "请选择有效站点。" },
			]);
		const settings = await repository.getSiteSettings(site.id);
		const hasAccountAccess =
			session.permissions.includes("comments.reply") &&
			(session.isAdmin || session.siteIds.includes(site.id));
		if (parsed.data.identity === "current_account")
			requireSiteAccess({
				session,
				siteRegistry: fastify.siteRegistry,
				siteKey: params.siteKey,
				permission: "comments.reply",
			});
		return {
			...evaluateEmailPolicy({
				email:
					parsed.data.identity === "current_account"
						? session.user.email
						: parsed.data.email,
				policy: parsed.data.policy,
				reservedEmail:
					parsed.data.verifiedAuthorEmail ??
					(mergeVerifiedAuthorSettings(settings?.verifiedAuthorJson).email ||
						undefined),
				authenticated:
					parsed.data.identity === "current_account" && hasAccountAccess,
			}),
			source: "draft",
			saved: false,
		};
	});

	fastify.patch("/:siteKey/sections/:section", async (request) => {
		const session = await sessionService.requireSession(request);
		const parsedParams = adminSiteSettingsSectionParamsSchema.safeParse(
			request.params,
		);
		const parsedBody = adminSectionPatchBodySchema.safeParse(request.body);
		if (!parsedParams.success || !parsedBody.success) {
			throw new ValidationFailedError(
				toValidationFields(
					[
						...(parsedParams.success ? [] : parsedParams.error.issues),
						...(parsedBody.success ? [] : parsedBody.error.issues),
					],
					{
						params: request.params,
						body: request.body,
					},
				),
			);
		}

		requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsedParams.data.siteKey,
			permission: "site_settings.update",
		});

		const parsedSettings = adminSettingsBodySchema.safeParse({
			[parsedParams.data.section]: parsedBody.data,
		});
		if (!parsedSettings.success) {
			throw new ValidationFailedError(
				toValidationFields(parsedSettings.error.issues, {
					[parsedParams.data.section]: parsedBody.data,
				}),
			);
		}

		const updateInput: SiteSettingsUpdateInput = {
			...parsedSettings.data,
			requestId: request.context?.requestId,
			actorUserId: session.user.id,
		};
		return service.updateSettings(parsedParams.data.siteKey, updateInput);
	});
};
