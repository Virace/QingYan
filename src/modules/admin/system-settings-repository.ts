import { eq } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { systemSettings } from "../../db/schema";

export class AdminSystemSettingsRepository {
	public constructor(private readonly db: AppDatabase) {}

	public async listByCategory(category: string) {
		return this.db
			.select()
			.from(systemSettings)
			.where(eq(systemSettings.category, category));
	}

	public async listAll() {
		return this.db.select().from(systemSettings);
	}

	public async upsert(category: string, key: string, value: unknown) {
		const valueJson = JSON.stringify(value);
		const updatedAt = new Date().toISOString();

		await this.db
			.insert(systemSettings)
			.values({
				category,
				key,
				valueJson,
				updatedAt,
			})
			.onConflictDoUpdate({
				target: [systemSettings.category, systemSettings.key],
				set: {
					valueJson,
					updatedAt,
				},
			});
	}
}
