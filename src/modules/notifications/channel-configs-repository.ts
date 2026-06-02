import { eq, inArray, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { AppDatabase } from "../../db/client";
import { notificationChannelConfigs } from "../../db/schema";

export type NotificationChannelType = "email" | "webhook" | "wxpusher";

export interface NotificationChannelConfigRecord {
	id: string;
	type: NotificationChannelType;
	name: string;
	description: string | null;
	enabled: boolean;
	config: Record<string, unknown>;
	secretConfigured: boolean;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface NotificationChannelConfigInput {
	id?: string;
	type: Exclude<NotificationChannelType, "email">;
	name: string;
	description?: string | null;
	enabled: boolean;
	config: Record<string, unknown>;
	secretConfig?: Record<string, unknown>;
}

export const defaultEmailChannelConfig: NotificationChannelConfigRecord = {
	id: "email:default",
	type: "email",
	name: "默认邮件",
	description: "使用系统 SMTP 设置发送邮件通知。",
	enabled: true,
	config: {},
	secretConfigured: false,
	createdAt: null,
	updatedAt: null,
};

function parseJsonObject(
	value: string | null | undefined,
): Record<string, unknown> {
	if (!value) {
		return {};
	}
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function serializeChannelConfig(
	row: typeof notificationChannelConfigs.$inferSelect,
): NotificationChannelConfigRecord {
	return {
		id: row.id,
		type: row.type as NotificationChannelType,
		name: row.name,
		description: row.description,
		enabled: row.enabled,
		config: parseJsonObject(row.configJson),
		secretConfigured:
			Object.keys(parseJsonObject(row.secretConfigJson)).length > 0,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class NotificationChannelConfigsRepository {
	public constructor(private readonly db: AppDatabase) {}

	public async list(): Promise<NotificationChannelConfigRecord[]> {
		const rows = await this.db.select().from(notificationChannelConfigs);
		const records = rows.map(serializeChannelConfig);
		if (!records.some((record) => record.id === defaultEmailChannelConfig.id)) {
			records.unshift(defaultEmailChannelConfig);
		}
		return records.sort((left, right) => left.id.localeCompare(right.id));
	}

	public async get(
		id: string,
	): Promise<NotificationChannelConfigRecord | null> {
		if (id === defaultEmailChannelConfig.id) {
			return defaultEmailChannelConfig;
		}
		const [row] = await this.db
			.select()
			.from(notificationChannelConfigs)
			.where(eq(notificationChannelConfigs.id, id))
			.limit(1);
		return row ? serializeChannelConfig(row) : null;
	}

	public async listByIds(ids: string[]) {
		const uniqueIds = Array.from(new Set(ids));
		const records: NotificationChannelConfigRecord[] = [];
		if (uniqueIds.includes(defaultEmailChannelConfig.id)) {
			records.push(defaultEmailChannelConfig);
		}
		const persistedIds = uniqueIds.filter(
			(id) => id !== defaultEmailChannelConfig.id,
		);
		if (persistedIds.length > 0) {
			const rows = await this.db
				.select()
				.from(notificationChannelConfigs)
				.where(inArray(notificationChannelConfigs.id, persistedIds));
			records.push(...rows.map(serializeChannelConfig));
		}
		return records;
	}

	public async replacePersisted(input: NotificationChannelConfigInput[]) {
		const nowIso = new Date().toISOString();
		const existingRows = await this.db
			.select({
				id: notificationChannelConfigs.id,
				secretConfigJson: notificationChannelConfigs.secretConfigJson,
			})
			.from(notificationChannelConfigs);
		const existingSecrets = new Map(
			existingRows.map((row) => [row.id, row.secretConfigJson ?? "{}"]),
		);
		await this.db
			.insert(notificationChannelConfigs)
			.values({
				id: defaultEmailChannelConfig.id,
				type: defaultEmailChannelConfig.type,
				name: defaultEmailChannelConfig.name,
				description: defaultEmailChannelConfig.description,
				enabled: defaultEmailChannelConfig.enabled,
				configJson: JSON.stringify(defaultEmailChannelConfig.config),
				secretConfigJson: "{}",
				createdAt: nowIso,
				updatedAt: nowIso,
			})
			.onConflictDoNothing();
		await this.db
			.delete(notificationChannelConfigs)
			.where(ne(notificationChannelConfigs.id, defaultEmailChannelConfig.id));
		const values = input.map((config) => {
			const id =
				config.id && config.id !== defaultEmailChannelConfig.id
					? config.id
					: `${config.type}:${randomUUID().replaceAll("-", "")}`;
			const nextSecretConfig = config.secretConfig ?? {};
			const secretConfigJson =
				Object.keys(nextSecretConfig).length > 0
					? JSON.stringify(nextSecretConfig)
					: (existingSecrets.get(id) ?? "{}");
			return {
				id,
				type: config.type,
				name: config.name,
				description: config.description ?? null,
				enabled: config.enabled,
				configJson: JSON.stringify(config.config ?? {}),
				secretConfigJson,
				createdAt: nowIso,
				updatedAt: nowIso,
			};
		});
		if (values.length > 0) {
			await this.db.insert(notificationChannelConfigs).values(values);
		}
		return this.list();
	}
}

export function channelTargetSnapshot(
	config: NotificationChannelConfigRecord,
	fallbackEmail?: string,
) {
	if (config.type === "email") {
		return fallbackEmail ?? config.name;
	}
	const summary = config.config.targetSummary;
	if (typeof summary === "string" && summary.trim()) {
		return `${config.name} / ${summary.trim()}`;
	}
	if (config.type === "webhook") {
		const url = typeof config.config.url === "string" ? config.config.url : "";
		if (!url) {
			return config.name;
		}
		try {
			const parsed = new URL(url);
			return `${parsed.origin}${parsed.pathname}`;
		} catch {
			return config.name;
		}
	}
	return config.name;
}
