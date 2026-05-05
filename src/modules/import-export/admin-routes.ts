import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { AdminRepository } from "../admin/repository";
import { AdminSessionService } from "../admin/session-service";
import { InvalidRequestError, ResourceNotFoundError } from "../shared/errors";
import { ImportJobRepository } from "./job-repository";
import { ImportJobService } from "./job-service";
import { QingYanExportService } from "./qingyan/export-service";
import { QingYanImportService } from "./qingyan/import-service";
import { WordPressAdminImportService } from "./wordpress/admin-service";

const explicitMappingSchema = z.object({
	siteKey: z.string().optional(),
	sourceBasePath: z.string().optional(),
	items: z.array(
		z.object({
			wpPostId: z.string().optional(),
			sourceRelativePath: z.string().optional(),
			decision: z.enum(["map", "skip"]),
			reason: z.string().optional(),
			target: z
				.object({
					pageKey: z.string(),
					pageUrl: z.string().optional(),
				})
				.optional(),
		}),
	),
});

const wordpressAnalyzeBodySchema = z.object({
	siteKey: z.string().min(1),
	fileName: z.string().min(1),
	xml: z.string().min(1),
	sourceBasePath: z.string().optional(),
	targetDistRoot: z.string().optional(),
	pageKeyStrategy: z
		.enum([
			"path_without_leading_slash",
			"path_with_leading_slash",
			"page_url_path",
			"custom_template",
			"explicit_only",
		])
		.optional(),
	postPathTemplate: z.string().optional(),
	pagePathTemplate: z.string().optional(),
	mapping: explicitMappingSchema.optional(),
});

const wordpressAnalyzeQuerySchema = wordpressAnalyzeBodySchema
	.omit({
		xml: true,
		mapping: true,
	})
	.extend({
		mappingJson: z.string().optional(),
	});
const importJobParamsSchema = z.object({
	jobId: z.string().min(1),
});
const dryRunBodySchema = z.object({
	existingStrategy: z.enum(["fail_on_existing", "skip_existing"]),
});
const applyBodySchema = dryRunBodySchema;
const qingyanExportBodySchema = z.object({
	siteKey: z.string().min(1),
	format: z.literal("qingyan.export.v1"),
	include: z
		.object({
			runtimeSettings: z.boolean().optional(),
			pageThreads: z.boolean().optional(),
			comments: z.boolean().optional(),
			visitors: z.boolean().optional(),
			voteRecords: z.boolean().optional(),
			pageFeedbackRecords: z.boolean().optional(),
			blacklistRules: z.boolean().optional(),
		})
		.optional(),
});
const qingyanDryRunBodySchema = z.object({
	siteKey: z.string().min(1),
	fileName: z.string().min(1),
	payload: z.unknown(),
	existingStrategy: z.enum(["fail_on_existing", "skip_existing"]),
});

function parseMappingJson(mappingJson?: string) {
	if (!mappingJson) {
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(mappingJson);
	} catch (error) {
		throw new InvalidRequestError({
			message: "mappingJson 不是有效 JSON。",
			cause: error instanceof Error ? error.message : String(error),
		});
	}

	const mapping = explicitMappingSchema.safeParse(parsed);
	if (!mapping.success) {
		throw new InvalidRequestError({
			issues: mapping.error.issues,
		});
	}

	return mapping.data;
}

export const adminImportExportRoutes: FastifyPluginAsync = async (fastify) => {
	fastify.addContentTypeParser(
		["application/xml", "text/xml"],
		{
			parseAs: "string",
			bodyLimit: Number.MAX_SAFE_INTEGER,
		},
		(_, body, done) => {
			done(null, body);
		},
	);

	const repository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		repository,
		fastify.adminBootstrap,
		fastify.siteRegistry,
	);
	const wordpressService = new WordPressAdminImportService();
	const jobService = new ImportJobService(
		new ImportJobRepository(fastify.db),
		fastify.sqlite,
	);
	const qingyanExportService = new QingYanExportService(fastify.sqlite);
	const qingyanImportService = new QingYanImportService(fastify.sqlite);

	fastify.post("/export", async (request, reply) => {
		await sessionService.requireSession(request);
		const parsed = qingyanExportBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		const site = fastify.siteRegistry.getRegisteredSite(parsed.data.siteKey);
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const payload = qingyanExportService.exportSite(parsed.data);
		const date = new Date().toISOString().slice(0, 10);
		return reply
			.type("application/json; charset=utf-8")
			.header(
				"content-disposition",
				`attachment; filename="qingyan-${parsed.data.siteKey}-${date}.json"`,
			)
			.send(payload);
	});

	fastify.post("/qingyan/dry-run", async (request) => {
		await sessionService.requireSession(request);
		const parsed = qingyanDryRunBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return qingyanImportService.createDryRun(parsed.data);
	});

	fastify.post("/wordpress/analyze", async (request) => {
		await sessionService.requireSession(request);

		if (typeof request.body === "string") {
			const parsed = wordpressAnalyzeQuerySchema.safeParse(request.query);
			if (!parsed.success) {
				throw new InvalidRequestError({
					issues: parsed.error.issues,
				});
			}
			const data = {
				...parsed.data,
				xml: request.body,
				mapping: parseMappingJson(parsed.data.mappingJson),
			};
			const site = fastify.siteRegistry.getRegisteredSite(data.siteKey);
			if (!site) {
				throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
			}

			const result = wordpressService.analyze(data);
			await jobService.createWordPressAnalyzeJob({
				siteId: site.id,
				xml: data.xml,
				result,
				options: parsed.data,
			});
			return result;
		}

		const parsed = wordpressAnalyzeBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		const site = fastify.siteRegistry.getRegisteredSite(parsed.data.siteKey);
		if (!site) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		const result = wordpressService.analyze(parsed.data);
		await jobService.createWordPressAnalyzeJob({
			siteId: site.id,
			xml: parsed.data.xml,
			result,
			options: {
				...parsed.data,
				xml: undefined,
			},
		});
		return result;
	});

	fastify.post("/wordpress/jobs/:jobId/plan", async (request) => {
		await sessionService.requireSession(request);
		const parsed = importJobParamsSchema.safeParse(request.params);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}

		return jobService.convertWordPressJobToPlan(parsed.data.jobId);
	});

	fastify.post("/jobs/:jobId/dry-run", async (request) => {
		await sessionService.requireSession(request);
		const parsedParams = importJobParamsSchema.safeParse(request.params);
		const parsedBody = dryRunBodySchema.safeParse(request.body);
		if (!parsedParams.success || !parsedBody.success) {
			throw new InvalidRequestError({
				issues: [
					...(parsedParams.success ? [] : parsedParams.error.issues),
					...(parsedBody.success ? [] : parsedBody.error.issues),
				],
			});
		}

		return jobService.dryRun(parsedParams.data.jobId, parsedBody.data);
	});

	fastify.post("/jobs/:jobId/apply", async (request) => {
		await sessionService.requireSession(request);
		const parsedParams = importJobParamsSchema.safeParse(request.params);
		const parsedBody = applyBodySchema.safeParse(request.body);
		if (!parsedParams.success || !parsedBody.success) {
			throw new InvalidRequestError({
				issues: [
					...(parsedParams.success ? [] : parsedParams.error.issues),
					...(parsedBody.success ? [] : parsedBody.error.issues),
				],
			});
		}

		return jobService.apply(parsedParams.data.jobId, parsedBody.data);
	});

	fastify.post("/qingyan/jobs/:jobId/apply", async (request) => {
		await sessionService.requireSession(request);
		const parsedParams = importJobParamsSchema.safeParse(request.params);
		const parsedBody = applyBodySchema.safeParse(request.body);
		if (!parsedParams.success || !parsedBody.success) {
			throw new InvalidRequestError({
				issues: [
					...(parsedParams.success ? [] : parsedParams.error.issues),
					...(parsedBody.success ? [] : parsedBody.error.issues),
				],
			});
		}

		return qingyanImportService.apply(parsedParams.data.jobId, parsedBody.data);
	});
};
