import { mkdir } from "node:fs/promises";
import path from "node:path";

import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

import { createDatabaseClients } from "../db/client";
import { applyDatabaseMigrations } from "../db/migrations";
import { resolveAdminBootstrap } from "../modules/admin/bootstrap-service";
import { AdminIdentityService } from "../modules/admin/admin-identity-service";
import { IpRegionAutoUpdateScheduler } from "../modules/comments/metadata/ip-region-scheduler";
import { RuntimeSystemSettingsService } from "../modules/system-settings/service";

const dbPlugin: FastifyPluginAsync = async (fastify) => {
	const databaseFile = path.resolve(
		process.cwd(),
		fastify.config.database.sqlite.file,
	);
	await mkdir(path.dirname(databaseFile), { recursive: true });

	const { db, sqlite } = createDatabaseClients(databaseFile);
	applyDatabaseMigrations(sqlite);
	fastify.decorate("db", db);
	fastify.decorate("sqlite", sqlite);
	const adminBootstrap = await resolveAdminBootstrap(
		fastify.config,
		db,
		fastify.runtimeOptions,
	);
	await new AdminIdentityService(db).ensureInitialAdmin(adminBootstrap);
	fastify.decorate("adminBootstrap", adminBootstrap);

	if (fastify.runtimeOptions.devMode.seed) {
		await fastify.siteRegistry.seedSiteFromTemplate(
			db,
			fastify.runtimeOptions.devMode.seed.site,
		);
	}
	await fastify.siteRegistry.loadFromDatabase(db);
	const systemSettingsService = new RuntimeSystemSettingsService(db);
	const ipRegionScheduler = new IpRegionAutoUpdateScheduler(db, () =>
		systemSettingsService.getIpRegionSettings(),
	);
	await ipRegionScheduler.start();

	fastify.addHook("onClose", async () => {
		ipRegionScheduler.stop();
		sqlite.close();
	});
};

export default fp(dbPlugin, {
	name: "qingyan-db",
});
