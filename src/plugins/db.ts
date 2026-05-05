import { mkdir } from "node:fs/promises";
import path from "node:path";

import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

import { createDatabaseClients } from "../db/client";
import { applyDatabaseMigrations } from "../db/migrations";
import { resolveAdminBootstrap } from "../modules/admin/bootstrap-service";
import { IpRegionAutoUpdateScheduler } from "../modules/comments/metadata/ip-region-scheduler";

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
	fastify.decorate(
		"adminBootstrap",
		await resolveAdminBootstrap(fastify.config, db, fastify.runtimeOptions),
	);

	if (fastify.runtimeOptions.devMode.seed) {
		await fastify.siteRegistry.seedSiteFromTemplate(
			db,
			fastify.runtimeOptions.devMode.seed.site,
		);
	}
	await fastify.siteRegistry.loadFromDatabase(db);
	const ipRegionScheduler = new IpRegionAutoUpdateScheduler(db, fastify.config);
	ipRegionScheduler.start();

	fastify.addHook("onClose", async () => {
		ipRegionScheduler.stop();
		sqlite.close();
	});
};

export default fp(dbPlugin, {
	name: "qingyan-db",
});
