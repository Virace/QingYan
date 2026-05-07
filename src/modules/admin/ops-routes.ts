import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";

import { AdminRepository } from "./repository";
import { AdminSessionService } from "./session-service";
import { GitHubReleaseClient } from "../ops/github-release-client";
import { OpsStatusService } from "../ops/ops-status-service";
import { UpdateCheckService } from "../ops/update-check-service";
import { UpgradeService } from "../upgrade/upgrade-service";

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
};
