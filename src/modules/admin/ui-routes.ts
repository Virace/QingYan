import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { renderAdminPage } from "./ui/render-admin-page";

const ADMIN_DIST_DIRECTORY = path.resolve(process.cwd(), "dist/admin");
const ADMIN_INDEX_HTML = path.join(ADMIN_DIST_DIRECTORY, "index.html");
const ADMIN_ASSETS_DIRECTORY = path.join(ADMIN_DIST_DIRECTORY, "assets");

function setAdminNoIndexHeaders(reply: FastifyReply): void {
	reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
	reply.header("Cache-Control", "no-store");
}

export const adminUiRoutes: FastifyPluginAsync = async (fastify) => {
	const adminPath = fastify.adminBootstrap.consolePath;
	const adminPaths = new Set([adminPath]);
	if (fastify.runtimeOptions.devMode.enabled) {
		adminPaths.add("/admin");
	}

	for (const basePath of adminPaths) {
		registerAdminUiPath(fastify, basePath);
	}
};

function registerAdminUiPath(
	fastify: Parameters<FastifyPluginAsync>[0],
	basePath: string,
): void {
	const renderShell = async () =>
		existsSync(ADMIN_INDEX_HTML)
			? injectAdminRuntime(await readFile(ADMIN_INDEX_HTML, "utf-8"), basePath)
			: renderAdminPage({ basePath });

	fastify.get(`${basePath}/assets/*`, async (request, reply) => {
		const assetName = (request.params as { "*": string })["*"];
		const assetPath = path.resolve(ADMIN_ASSETS_DIRECTORY, assetName);
		if (
			!isPathInsideDirectory(ADMIN_ASSETS_DIRECTORY, assetPath) ||
			!existsSync(assetPath)
		) {
			return reply.code(404).send({
				error: {
					code: "ADMIN_ASSET_NOT_FOUND",
					message: "Admin asset not found.",
				},
			});
		}

		const extname = path.extname(assetPath);
		const contentType =
			extname === ".js"
				? "text/javascript; charset=utf-8"
				: extname === ".css"
					? "text/css; charset=utf-8"
					: "application/octet-stream";
		return reply.type(contentType).send(await readFile(assetPath));
	});

	fastify.get(`${basePath}/install`, async (_, reply) => {
		return reply.code(410).send({
			error: {
				code: "INSTALL_ROUTE_DISABLED",
				message: "安装流程已关闭。请访问当前管理后台入口。",
			},
		});
	});

	fastify.get(basePath, async (request, reply) => {
		const redirectUrl = resolveMissingSlashRedirect(basePath, request);
		if (redirectUrl) {
			return reply.redirect(redirectUrl);
		}

		setAdminNoIndexHeaders(reply);
		return reply.type("text/html; charset=utf-8").send(await renderShell());
	});
}

function resolveMissingSlashRedirect(
	basePath: string,
	request: FastifyRequest,
): string | undefined {
	const pathname = request.url.split("?", 1)[0];
	return pathname === basePath
		? buildRedirectUrl(`${basePath}/`, request.url)
		: undefined;
}

function buildRedirectUrl(pathname: string, requestUrl: string): string {
	const queryStart = requestUrl.indexOf("?");
	return queryStart === -1
		? pathname
		: `${pathname}${requestUrl.slice(queryStart)}`;
}

function injectAdminRuntime(html: string, basePath: string): string {
	const runtimeScript = `<script>window.__QINGYAN_ADMIN__=${JSON.stringify({ basePath })};</script>`;
	return html.replace("</head>", `${runtimeScript}</head>`);
}

function isPathInsideDirectory(directory: string, target: string): boolean {
	const relative = path.relative(directory, target);
	return (
		Boolean(relative) &&
		!relative.startsWith("..") &&
		!path.isAbsolute(relative)
	);
}
