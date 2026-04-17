import { mkdir } from "node:fs/promises";
import path from "node:path";

import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

import { createDatabaseClients } from "../db/client";

const dbPlugin: FastifyPluginAsync = async (fastify) => {
	const databaseFile = path.resolve(
		process.cwd(),
		fastify.config.database.sqlite.file,
	);
	await mkdir(path.dirname(databaseFile), { recursive: true });

	const { db, sqlite } = createDatabaseClients(databaseFile);
	fastify.decorate("db", db);
	fastify.decorate("sqlite", sqlite);

	await fastify.siteRegistry.sync(db);

	fastify.addHook("onClose", async () => {
		sqlite.close();
	});
};

export default fp(dbPlugin, {
	name: "qingyan-db",
});
