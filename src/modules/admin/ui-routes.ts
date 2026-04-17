import type { FastifyPluginAsync } from "fastify";

import { renderAdminPage } from "./ui/render-admin-page";

export const adminUiRoutes: FastifyPluginAsync = async (fastify) => {
	fastify.get("/admin", async (_, reply) =>
		reply.type("text/html; charset=utf-8").send(renderAdminPage()),
	);
};
