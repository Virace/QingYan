import path from "node:path";

import { defineConfig } from "drizzle-kit";

const sqliteFile = process.env.QINGYAN_DB_FILE ?? "./data/qingyan.db";

export default defineConfig({
	out: "./drizzle",
	schema: "./src/db/schema/index.ts",
	dialect: "sqlite",
	dbCredentials: {
		url: path.resolve(process.cwd(), sqliteFile),
	},
	verbose: true,
	strict: true,
});
