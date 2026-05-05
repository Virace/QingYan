import type { Plugin } from "vite";

const DEFAULT_ADMIN_PATH = "/admin";

function normalizeAdminPath(pathname: string): string {
	const normalized = pathname.trim();
	if (!normalized || normalized === "/") {
		return DEFAULT_ADMIN_PATH;
	}
	const withLeadingSlash = normalized.startsWith("/")
		? normalized
		: `/${normalized}`;
	return withLeadingSlash.endsWith("/") && withLeadingSlash.length > 1
		? withLeadingSlash.slice(0, -1)
		: withLeadingSlash;
}

export function resolveAdminDevPaths(
	environment: NodeJS.ProcessEnv = process.env,
): string[] {
	const rawPaths =
		environment.QINGYAN_ADMIN_DEV_PATHS ?? environment.QINGYAN_ADMIN_PATH;
	const paths = rawPaths
		? rawPaths.split(",").map((item) => normalizeAdminPath(item))
		: [DEFAULT_ADMIN_PATH];
	return Array.from(new Set(paths));
}

export function isAllowedAdminHtmlPath(
	pathname: string,
	adminPaths: string[],
): boolean {
	return adminPaths.some(
		(adminPath) => pathname === adminPath || pathname === `${adminPath}/`,
	);
}

export function adminRouteGuard(adminPaths: string[]): Plugin {
	return {
		name: "qingyan-admin-route-guard",
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				const method = request.method ?? "GET";
				if (method !== "GET" && method !== "HEAD") {
					next();
					return;
				}

				const accept = request.headers.accept ?? "";
				if (!accept.includes("text/html")) {
					next();
					return;
				}

				const requestUrl = request.url ?? "/";
				const pathname = new URL(requestUrl, "http://localhost").pathname;
				if (isAllowedAdminHtmlPath(pathname, adminPaths)) {
					next();
					return;
				}

				response.statusCode = 404;
				response.setHeader("content-type", "text/plain; charset=utf-8");
				response.end("Not found.");
			});
		},
	};
}
