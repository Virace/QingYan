import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { AdminRepository } from "./repository";
import { AdminSessionService } from "./session-service";
import { CommentIpMaintenanceService } from "../comments/metadata/comment-ip-maintenance-service";
import { GitHubReleaseClient } from "../ops/github-release-client";
import { MaintenanceJobRepository } from "../ops/maintenance-job-repository";
import { OpsStatusService } from "../ops/ops-status-service";
import { UpdateCheckService } from "../ops/update-check-service";
import { PageMetadataRefreshService } from "../page-registry/title-refresh-service";
import { InvalidRequestError } from "../shared/errors";
import { RuntimeSystemSettingsService } from "../system-settings/service";
import { UpgradeService } from "../upgrade/upgrade-service";

const ipVersionSchema = z.enum(["v4", "v6"]);
const ipRegionUpdateBodySchema = z.object({
	ipVersions: z.array(ipVersionSchema).min(1).max(2),
});
const commentIpRefreshBodySchema = z.object({
	scope: z.enum(["missing", "failed", "stale", "all"]),
	ipVersions: z.array(ipVersionSchema).min(1).max(2),
	siteKey: z.string().min(1).optional(),
	batchSize: z.number().int().min(1).max(5000).default(500),
});
const maintenanceJobParamsSchema = z.object({
	jobId: z.string().min(1),
});
const maintenanceTasksQuerySchema = z.object({
	siteKey: z.string().min(1).optional(),
	type: z.string().min(1).optional(),
	status: z.string().min(1).optional(),
	limit: z.coerce.number().int().positive().max(100).default(20),
});
const pageTitleRefreshTaskBodySchema = z.object({
	siteKey: z.string().min(1),
	pageKeys: z.array(z.string().min(1)).min(1).max(100).optional(),
	onlyMissingTitle: z.boolean().default(true),
	forceTitle: z.boolean().optional(),
	batchSize: z.number().int().min(1).max(5000).optional(),
	runAfter: z.string().datetime().nullable().optional(),
	maxAttempts: z.number().int().min(1).max(10).optional(),
	retryDelaySec: z.number().int().min(0).max(86_400).optional(),
});

function readPackageVersion(): string {
	const packagePath = path.resolve(process.cwd(), "package.json");
	const packageJson = JSON.parse(readFileSync(packagePath, "utf-8")) as {
		version?: string;
	};
	return packageJson.version ?? "0.0.0";
}

export const adminOpsRoutes: FastifyPluginAsync = async (fastify) => {
	const repository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		repository,
		fastify.adminBootstrap,
		fastify.siteRegistry,
	);
	const version = readPackageVersion();
	const databaseFile = path.resolve(
		process.cwd(),
		fastify.config.database.sqlite.file,
	);
	const upgradeService = new UpgradeService({
		configPath: process.env.QINGYAN_CONFIG_PATH ?? "config/qingyan.yml",
		loadedConfig: fastify.config,
		databaseFile,
		currentApplicationVersion: version,
		partialUpgradeMarkerPath: path.join(
			path.dirname(databaseFile),
			"upgrade",
			"partial-upgrade.json",
		),
		createSqliteClient: (file) => new Database(file),
	});
	const releaseClient = new GitHubReleaseClient({
		owner: "Virace",
		repo: "QingYan",
	});
	const updateCheckService = new UpdateCheckService({
		currentVersion: version,
		source: {
			provider: "github-releases",
			owner: "Virace",
			repo: "QingYan",
			url: releaseClient.sourceUrl(),
		},
		fetchLatest: () => releaseClient.fetchLatest(),
	});
	const ops = new OpsStatusService({
		version,
		upgradeService,
		updateCheckService,
	});
	const maintenanceJobs = new MaintenanceJobRepository(fastify.db);
	const titleRefresh = new PageMetadataRefreshService(
		fastify.db,
		maintenanceJobs,
		{
			fetchHtml:
				fastify.pageTitleFetchHtml ??
				(async (url) => {
					const response = await fetch(url);
					return { status: response.status, text: await response.text() };
				}),
		},
	);
	const systemSettings = new RuntimeSystemSettingsService(fastify.db);
	const ipMaintenance = new CommentIpMaintenanceService(
		fastify.db,
		maintenanceJobs,
		{
			loadIpRegionSettings: () => systemSettings.getIpRegionSettings(),
		},
	);

	fastify.get("/status", async (request) => {
		await sessionService.requireSession(request);
		return ops.getStatus();
	});

	fastify.post("/upgrade/dry-run", async (request) => {
		await sessionService.requireSession(request);
		return upgradeService.publicState();
	});

	fastify.post("/update/plan", async (request) => {
		await sessionService.requireSession(request);
		return ops.getUpdatePlan();
	});

	fastify.post("/update/check", async (request) => {
		await sessionService.requireSession(request);
		return ops.checkForUpdates();
	});

	fastify.get("/ip-region", async (request) => {
		await sessionService.requireSession(request);
		return ipMaintenance.getStatus();
	});

	fastify.post("/ip-region/update", async (request) => {
		await sessionService.requireSession(request);
		const parsed = ipRegionUpdateBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		const job = await ipMaintenance.createIpRegionUpdateJob(parsed.data);
		void ipMaintenance.runNextQueuedJob();
		return { job };
	});

	fastify.post("/comment-ip/refresh", async (request) => {
		await sessionService.requireSession(request);
		const parsed = commentIpRefreshBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		const job = await ipMaintenance.createCommentIpRefreshJob(parsed.data);
		void ipMaintenance.runNextQueuedJob();
		return { job };
	});

	fastify.get("/maintenance-jobs/:jobId", async (request) => {
		await sessionService.requireSession(request);
		const parsed = maintenanceJobParamsSchema.safeParse(request.params);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		return {
			job: await maintenanceJobs.get(parsed.data.jobId),
		};
	});

	fastify.get("/tasks", async (request) => {
		await sessionService.requireSession(request);
		const parsed = maintenanceTasksQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		const jobs = (await maintenanceJobs.listRecent(parsed.data.limit)).filter(
			(job) =>
				(parsed.data.siteKey === undefined ||
					job.siteKey === parsed.data.siteKey) &&
				(parsed.data.type === undefined || job.type === parsed.data.type) &&
				(parsed.data.status === undefined || job.status === parsed.data.status),
		);
		return {
			items: jobs.map((job) => ({
				source: "maintenance" as const,
				...job,
			})),
		};
	});

	fastify.post("/tasks/page-title-refresh", async (request) => {
		await sessionService.requireSession(request);
		const parsed = pageTitleRefreshTaskBodySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		return {
			job: await titleRefresh.createRefreshJob({
				siteKey: parsed.data.siteKey,
				pageKeys: parsed.data.pageKeys,
				onlyMissingTitle: parsed.data.onlyMissingTitle,
				forceTitle: parsed.data.forceTitle,
				batchSize: parsed.data.batchSize,
				trigger: "manual",
				runAfter: parsed.data.runAfter ?? null,
				maxAttempts: parsed.data.maxAttempts,
				retryDelaySec: parsed.data.retryDelaySec,
			}),
		};
	});
};
