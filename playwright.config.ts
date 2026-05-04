import { defineConfig, devices } from "@playwright/test";

const apiPort = Number(process.env.QINGYAN_E2E_API_PORT ?? 4401);
const adminPort = Number(process.env.QINGYAN_E2E_ADMIN_PORT ?? 5173);

export default defineConfig({
	testDir: "./tests/e2e",
	outputDir: ".temp/playwright/results",
	fullyParallel: false,
	retries: process.env.CI ? 2 : 0,
	reporter: [["list"]],
	use: {
		baseURL: `http://127.0.0.1:${adminPort}`,
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: [
		{
			command: `pnpm exec tsx src/server.ts`,
			url: `http://127.0.0.1:${apiPort}/api/admin/session/captcha`,
			reuseExistingServer: !process.env.CI,
			timeout: 30_000,
			env: {
				QINGYAN_DEV_MODE: "true",
				QINGYAN_DEV_ADMIN_USERNAME: "admin",
				QINGYAN_DEV_ADMIN_PASSWORD: "admin",
				QINGYAN_TEST_CAPTCHA_ANSWER: "2468",
			},
		},
		{
			command: `pnpm exec vite --config apps/admin/vite.config.ts --host 127.0.0.1 --port ${adminPort}`,
			url: `http://127.0.0.1:${adminPort}/admin/`,
			reuseExistingServer: !process.env.CI,
			timeout: 30_000,
			env: {
				QINGYAN_ADMIN_BASE: "/admin/",
				QINGYAN_DEV_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
			},
		},
	],
});
