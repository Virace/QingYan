import { eq, sql } from "drizzle-orm";

import type { AppTransaction, DatabaseExecutor } from "../../db/client";
import { auditLogs, systemSettings } from "../../db/schema";

export class AdminSystemSettingsRepository {
	public constructor(private readonly db: DatabaseExecutor) {}

	public async transaction<T>(
		callback: (
			repository: AdminSystemSettingsRepository,
			tx: AppTransaction,
		) => Promise<T>,
	): Promise<T> {
		return this.db.transaction(async (tx) => {
			// 空表也必须串行读取和合并设置，不能只锁已有设置行。
			await tx.execute(sql`select pg_advisory_xact_lock(174007, 2)`);
			return callback(new AdminSystemSettingsRepository(tx), tx);
		});
	}

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

	public async writeAudit(input: {
		actorType: string;
		actorId?: string;
		action: string;
		targetType: string;
		targetId: string;
		payload?: Record<string, unknown>;
	}) {
		await this.db.insert(auditLogs).values({
			actorType: input.actorType,
			actorId: input.actorId,
			action: input.action,
			targetType: input.targetType,
			targetId: input.targetId,
			payloadJson: input.payload ? JSON.stringify(input.payload) : undefined,
		});
	}
}
