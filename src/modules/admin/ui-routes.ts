import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { joinPublicPath } from "../../config/public-path";

interface AdminUiRouteOptions {
	distDirectory?: string;
	publicPath?: string;
}

interface AdminDistPaths {
	indexHtml: string;
	assetsDirectory: string;
}

function setAdminNoIndexHeaders(reply: FastifyReply): void {
	reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
	reply.header("Cache-Control", "no-store");
}

export const adminUiRoutes: FastifyPluginAsync<AdminUiRouteOptions> = async (
	fastify,
	options,
) => {
	const adminPath = fastify.adminBootstrap.consolePath;
	const distPaths = resolveAdminDistPaths(options.distDirectory);
	const adminPaths = new Set([adminPath]);
	if (fastify.runtimeOptions.devMode.enabled) {
		adminPaths.add("/admin");
	}

	for (const basePath of adminPaths) {
		const externalBasePath =
			options.publicPath && basePath.startsWith("/")
				? joinPublicPath(options.publicPath, basePath)
				: basePath;
		registerAdminUiPath(fastify, basePath, distPaths, {
			externalBasePath,
			apiBase: options.publicPath
				? joinPublicPath(options.publicPath, "/api")
				: "/api",
		});
	}
};

function registerAdminUiPath(
	fastify: Parameters<FastifyPluginAsync>[0],
	basePath: string,
	distPaths: AdminDistPaths,
	options: {
		externalBasePath: string;
		apiBase: string;
	},
): void {
	const renderShell = async () =>
		existsSync(distPaths.indexHtml)
			? injectAdminRuntime(
					await readFile(distPaths.indexHtml, "utf-8"),
					options.externalBasePath,
					options.apiBase,
				)
			: undefined;

	fastify.get(`${basePath}/assets/*`, async (request, reply) => {
		const assetName = (request.params as { "*": string })["*"];
		const assetPath = path.resolve(distPaths.assetsDirectory, assetName);
		if (
			!isPathInsideDirectory(distPaths.assetsDirectory, assetPath) ||
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
		const redirectUrl = resolveMissingSlashRedirect(
			options.externalBasePath,
			request,
		);
		if (redirectUrl) {
			return reply.redirect(redirectUrl);
		}

		setAdminNoIndexHeaders(reply);
		const shell = await renderShell();
		if (!shell) {
			return reply.code(503).send({
				error: {
					code: "ADMIN_UI_NOT_BUILT",
					message:
						"Admin UI build output is missing. Run pnpm run admin:build before serving the backend.",
				},
			});
		}

		return reply.type("text/html; charset=utf-8").send(shell);
	});
}

function resolveAdminDistPaths(distDirectory?: string): AdminDistPaths {
	const directory = path.resolve(process.cwd(), distDirectory ?? "dist/admin");
	return {
		indexHtml: path.join(directory, "index.html"),
		assetsDirectory: path.join(directory, "assets"),
	};
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

function injectAdminRuntime(
	html: string,
	basePath: string,
	apiBase: string,
): string {
	const runtimeScript = `<script>window.__QINGYAN_ADMIN__=${JSON.stringify({ basePath, apiBase })};</script>`;
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
