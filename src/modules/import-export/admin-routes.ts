import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { AdminRepository } from "../admin/repository";
import { AdminSessionService } from "../admin/session-service";
import { DatabaseBackupService } from "../database-backup/database-backup-service";
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
const importJobsQuerySchema = z.object({
	siteKey: z.string().min(1).optional(),
	status: z.string().min(1).optional(),
	sourceType: z.string().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(20),
});
const dryRunBodySchema = z.object({
	existingStrategy: z.enum(["fail_on_existing", "skip_existing"]),
});
const qingyanImportModeSchema = z
	.enum(["data_only", "settings_only", "full_site"])
	.default("full_site");
const qingyanSettingsStrategySchema = z
	.enum(["fail_on_existing", "replace_settings"])
	.default("fail_on_existing");
const applyBodySchema = dryRunBodySchema;
const qingyanApplyBodySchema = dryRunBodySchema.extend({
	importMode: qingyanImportModeSchema.optional(),
	settingsStrategy: qingyanSettingsStrategySchema.optional(),
});
const qingyanExportBodySchema = z.object({
	siteKey: z.string().min(1),
	format: z.literal("qingyan.export.v1"),
	include: z
		.object({
			siteSettings: z.boolean().optional(),
			systemSettings: z.boolean().optional(),
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
	importMode: qingyanImportModeSchema.optional(),
	settingsStrategy: qingyanSettingsStrategySchema.optional(),
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

function parseJsonField(value: string | null | undefined) {
	if (!value) {
		return null;
	}
	return JSON.parse(value) as unknown;
}

function summarizeJobPayload(value: string) {
	const payload = parseJsonField(value);
	if (!payload || typeof payload !== "object") {
		return {};
	}
	const record = payload as Record<string, unknown>;
	return {
		report:
			record.report &&
			typeof record.report === "object" &&
			"summary" in record.report
				? (record.report as { summary?: unknown }).summary
				: undefined,
		plan:
			record.plan && typeof record.plan === "object" && "summary" in record.plan
				? (record.plan as { summary?: unknown }).summary
				: undefined,
		dryRun:
			record.dryRun &&
			typeof record.dryRun === "object" &&
			"summary" in record.dryRun
				? (record.dryRun as { summary?: unknown }).summary
				: undefined,
		apply:
			record.apply &&
			typeof record.apply === "object" &&
			"summary" in record.apply
				? (record.apply as { summary?: unknown }).summary
				: undefined,
	};
}

function serializeImportJob(
	batch: Awaited<ReturnType<ImportJobRepository["getBatch"]>>,
) {
	if (!batch) {
		return null;
	}
	return {
		id: batch.id,
		siteId: batch.siteId,
		sourceType: batch.sourceType,
		sourceFileName: batch.sourceFileName,
		format: batch.format,
		formatVersion: batch.formatVersion,
		status: batch.status,
		createdAt: batch.createdAt,
		updatedAt: batch.updatedAt,
		appliedAt: batch.appliedAt,
		summary: summarizeJobPayload(batch.summaryJson),
		backup: parseJsonField(batch.backupJson),
		error: parseJsonField(batch.errorJson),
	};
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
	const importJobRepository = new ImportJobRepository(fastify.db);
	const backupService = new DatabaseBackupService({
		engine: fastify.config.database.client,
		databaseFile: fastify.config.database.sqlite.file,
		sqlite: fastify.sqlite,
	});
	const jobService = new ImportJobService(
		importJobRepository,
		fastify.sqlite,
		backupService,
	);
	const qingyanExportService = new QingYanExportService(fastify.sqlite);
	const qingyanImportService = new QingYanImportService(
		fastify.sqlite,
		backupService,
	);

	fastify.get("/jobs", async (request) => {
		await sessionService.requireSession(request);
		const parsed = importJobsQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		const siteId = parsed.data.siteKey
			? fastify.siteRegistry.getRegisteredSite(parsed.data.siteKey)?.id
			: undefined;
		if (parsed.data.siteKey && !siteId) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}
		const rows = await importJobRepository.listBatches({
			siteId,
			status: parsed.data.status,
			sourceType: parsed.data.sourceType,
			limit: parsed.data.limit,
		});
		return {
			items: rows.map((row) => serializeImportJob(row)),
			nextCursor: null,
		};
	});

	fastify.get("/jobs/:jobId", async (request) => {
		await sessionService.requireSession(request);
		const parsed = importJobParamsSchema.safeParse(request.params);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		const batch = await importJobRepository.getBatch(parsed.data.jobId);
		const job = serializeImportJob(batch);
		if (!job) {
			throw new ResourceNotFoundError(
				"IMPORT_JOB_NOT_FOUND",
				"导入任务不存在。",
			);
		}
		return { job };
	});

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
		const parsedBody = qingyanApplyBodySchema.safeParse(request.body);
		if (!parsedParams.success || !parsedBody.success) {
			throw new InvalidRequestError({
				issues: [
					...(parsedParams.success ? [] : parsedParams.error.issues),
					...(parsedBody.success ? [] : parsedBody.error.issues),
				],
			});
		}

		return qingyanImportService.applyWithBackup(
			parsedParams.data.jobId,
			parsedBody.data,
		);
	});
};
