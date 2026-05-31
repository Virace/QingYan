import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { adminRouteGuard, resolveAdminDevPaths } from "./route-guard";

const adminBase = process.env.QINGYAN_ADMIN_BASE ?? "./";
const apiOrigin = process.env.QINGYAN_DEV_API_ORIGIN ?? "http://127.0.0.1:4401";
const devApiBase = process.env.QINGYAN_DEV_API_BASE;
const publicApiProxyTarget = devApiBase ? new URL(apiOrigin).origin : undefined;

function adminRuntimePlugin() {
	return {
		name: "qingyan-admin-runtime",
		transformIndexHtml(html: string) {
			if (!devApiBase) {
				return html;
			}
			const runtimeScript = `<script>window.__QINGYAN_ADMIN__=${JSON.stringify({ apiBase: devApiBase })};</script>`;
			return html.replace("</head>", `${runtimeScript}</head>`);
		},
	};
}

export default defineConfig({
	root: __dirname,
	base: adminBase,
	plugins: [
		adminRouteGuard(resolveAdminDevPaths()),
		adminRuntimePlugin(),
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	server: {
		proxy: {
			"/api": {
				target: apiOrigin,
				changeOrigin: true,
			},
			...(devApiBase && devApiBase !== "/api" && publicApiProxyTarget
				? {
						[devApiBase]: {
							target: publicApiProxyTarget,
							changeOrigin: true,
						},
					}
				: {}),
		},
	},
	build: {
		emptyOutDir: true,
		outDir: "../../dist/admin",
	},
});
