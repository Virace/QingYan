import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { adminRouteGuard, resolveAdminDevPaths } from "./route-guard";

const adminBase = process.env.QINGYAN_ADMIN_BASE ?? "./";
const apiOrigin = process.env.QINGYAN_DEV_API_ORIGIN ?? "http://127.0.0.1:4401";

export default defineConfig({
	root: __dirname,
	base: adminBase,
	plugins: [adminRouteGuard(resolveAdminDevPaths()), react(), tailwindcss()],
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
		},
	},
	build: {
		emptyOutDir: true,
		outDir: "../../dist/admin",
	},
});
