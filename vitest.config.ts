import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		maxWorkers: 2,
		hookTimeout: 30000,
		testTimeout: 30000,
		exclude: ["dist/**", "node_modules/**"],
	},
});
