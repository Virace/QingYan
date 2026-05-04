import path from "node:path";

import { loadConfig } from "../src/config/load-config";
import { createDatabaseClients } from "../src/db/client";
import { IpRegionUpdater } from "../src/modules/comments/metadata/ip-region-updater";

async function main(): Promise<void> {
	const command = process.argv[2] ?? "update";
	if (command !== "update") {
		throw new Error(`Unknown ip-region command: ${command}`);
	}

	const config = await loadConfig();
	const databaseFile = path.resolve(process.cwd(), config.database.sqlite.file);
	const { db, sqlite } = createDatabaseClients(databaseFile);
	const updater = new IpRegionUpdater(db);

	try {
		const results = [];
		for (const site of config.sites) {
			const ipRegion = site.defaults.comments.metadata.ipRegion;
			if (!ipRegion.autoUpdate.enabled && !ipRegion.enabled) {
				continue;
			}

			results.push({
				siteKey: site.siteKey,
				ipVersion: "v4",
				result: await updater.update({ ipVersion: "v4", config: ipRegion }),
			});
			results.push({
				siteKey: site.siteKey,
				ipVersion: "v6",
				result: await updater.update({ ipVersion: "v6", config: ipRegion }),
			});
		}

		console.log(JSON.stringify({ results }, null, 2));
	} finally {
		sqlite.close();
	}
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
