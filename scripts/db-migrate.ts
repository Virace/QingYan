import { createDatabaseClients } from "../src/db/client";
import { applyDatabaseMigrations } from "../src/db/migrations";

async function main(): Promise<void> {
	const url = process.env.QINGYAN_DATABASE_URL;
	if (!url) throw new Error("QINGYAN_DATABASE_URL is required");
	const clients = createDatabaseClients(url);
	try {
		await applyDatabaseMigrations(clients.pool);
		console.log("Database migrations applied");
	} finally {
		await clients.close();
	}
}

main().catch(() => {
	console.error("Database migration failed");
	process.exitCode = 1;
});
