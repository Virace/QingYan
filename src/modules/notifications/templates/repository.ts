import { eq } from "drizzle-orm";

import type { AppDatabase } from "../../../db/client";
import { notificationTemplates } from "../../../db/schema";
import {
	defaultNotificationTemplates,
	notificationTemplateFormatMetadata,
	type DefaultNotificationTemplate,
	type NotificationTemplatePlaceholder,
} from "./defaults";
import type { NotificationTemplateFormat } from "./renderer";

export interface NotificationTemplateRecord {
	key: string;
	name: string;
	description: string;
	channel: "email" | "webhook" | "wxpusher";
	channelLabel: string;
	channelDescription: string;
	eventType: string;
	eventLabel: string;
	eventDescription: string;
	triggerDescription: string;
	recipientType: string;
	placeholders: NotificationTemplatePlaceholder[];
	format: NotificationTemplateFormat;
	formatLabel: string;
	supportsSubject: boolean;
	subjectTemplate: string | null;
	bodyTemplate: string;
	isCustomized: boolean;
	updatedAt: string | null;
	updatedByUserId: number | null;
}

function fromDefault(
	template: DefaultNotificationTemplate,
): NotificationTemplateRecord {
	return {
		key: template.key,
		name: template.name,
		description: template.description,
		channel: template.channel,
		channelLabel: template.channelLabel,
		channelDescription: template.channelDescription,
		eventType: template.eventType,
		eventLabel: template.eventLabel,
		eventDescription: template.eventDescription,
		triggerDescription: template.triggerDescription,
		recipientType: template.recipientType,
		placeholders: template.placeholders,
		format: template.format,
		formatLabel: template.formatLabel,
		supportsSubject: template.supportsSubject,
		subjectTemplate: template.subjectTemplate ?? null,
		bodyTemplate: template.bodyTemplate,
		isCustomized: false,
		updatedAt: null,
		updatedByUserId: null,
	};
}

function defaultByKey(key: string) {
	return defaultNotificationTemplates.find((template) => template.key === key);
}

export class NotificationTemplateRepository {
	public constructor(private readonly db: AppDatabase) {}

	public async list(): Promise<NotificationTemplateRecord[]> {
		const overrides = await this.db.select().from(notificationTemplates);
		const overrideByKey = new Map(overrides.map((row) => [row.key, row]));
		const records = defaultNotificationTemplates.map((template) => {
			const override = overrideByKey.get(template.key);
			if (!override) {
				return fromDefault(template);
			}
			return {
				key: override.key,
				name: template.name,
				description: template.description,
				channel: override.channel as NotificationTemplateRecord["channel"],
				channelLabel: template.channelLabel,
				channelDescription: template.channelDescription,
				eventType: override.eventType,
				eventLabel: template.eventLabel,
				eventDescription: template.eventDescription,
				triggerDescription: template.triggerDescription,
				recipientType: template.recipientType,
				placeholders: template.placeholders,
				format: override.format as NotificationTemplateFormat,
				formatLabel:
					notificationTemplateFormatMetadata[
						override.format as NotificationTemplateFormat
					].label,
				supportsSubject: template.supportsSubject,
				subjectTemplate: override.subjectTemplate,
				bodyTemplate: override.bodyTemplate,
				isCustomized: true,
				updatedAt: override.updatedAt,
				updatedByUserId: override.updatedByUserId,
			};
		});

		return records.sort((left, right) => left.key.localeCompare(right.key));
	}

	public async get(key: string): Promise<NotificationTemplateRecord | null> {
		const [override] = await this.db
			.select()
			.from(notificationTemplates)
			.where(eq(notificationTemplates.key, key))
			.limit(1);
		if (override) {
			const fallback = defaultByKey(key);
			return {
				key: override.key,
				name: fallback?.name ?? override.key,
				description: fallback?.description ?? override.key,
				channel: override.channel as NotificationTemplateRecord["channel"],
				channelLabel: fallback?.channelLabel ?? override.channel,
				channelDescription: fallback?.channelDescription ?? override.channel,
				eventType: override.eventType,
				eventLabel: fallback?.eventLabel ?? override.eventType,
				eventDescription: fallback?.eventDescription ?? override.eventType,
				triggerDescription:
					fallback?.triggerDescription ??
					fallback?.eventDescription ??
					override.eventType,
				recipientType: fallback?.recipientType ?? "通知接收人",
				placeholders: fallback?.placeholders ?? [],
				format: override.format as NotificationTemplateFormat,
				formatLabel:
					notificationTemplateFormatMetadata[
						override.format as NotificationTemplateFormat
					].label,
				supportsSubject: fallback?.supportsSubject ?? true,
				subjectTemplate: override.subjectTemplate,
				bodyTemplate: override.bodyTemplate,
				isCustomized: true,
				updatedAt: override.updatedAt,
				updatedByUserId: override.updatedByUserId,
			};
		}
		const fallback = defaultByKey(key);
		return fallback ? fromDefault(fallback) : null;
	}

	public async upsert(input: {
		key: string;
		format: NotificationTemplateFormat;
		subjectTemplate?: string | null;
		bodyTemplate: string;
		updatedByUserId?: number | null;
	}) {
		const base = defaultByKey(input.key);
		if (!base) {
			return null;
		}
		const updatedAt = new Date().toISOString();
		await this.db
			.insert(notificationTemplates)
			.values({
				key: input.key,
				channel: base.channel,
				eventType: base.eventType,
				format: input.format,
				subjectTemplate: input.subjectTemplate ?? null,
				bodyTemplate: input.bodyTemplate,
				updatedAt,
				updatedByUserId: input.updatedByUserId ?? null,
			})
			.onConflictDoUpdate({
				target: notificationTemplates.key,
				set: {
					format: input.format,
					subjectTemplate: input.subjectTemplate ?? null,
					bodyTemplate: input.bodyTemplate,
					updatedAt,
					updatedByUserId: input.updatedByUserId ?? null,
				},
			});
		return this.get(input.key);
	}

	public async restoreDefault(key: string) {
		const fallback = defaultByKey(key);
		if (!fallback) {
			return null;
		}
		await this.db
			.delete(notificationTemplates)
			.where(eq(notificationTemplates.key, key));
		return fromDefault(fallback);
	}
}
