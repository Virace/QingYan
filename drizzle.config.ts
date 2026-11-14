import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "./drizzle/postgresql",
	schema: "./src/db/schema/index.ts",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.QINGYAN_DATABASE_URL ?? "postgresql://localhost/qingyan",
	},
	verbose: true,
	strict: true,
});
