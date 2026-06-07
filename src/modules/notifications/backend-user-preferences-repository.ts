import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { adminUserNotificationPreferences } from "../../db/schema";
import type { BackendUserNotificationChannel } from "./backend-user-recipients-repository";

export type BackendUserDigestMode = "off" | "interval" | "fixed_time";

export interface BackendUserNotificationPreference {
	userId: number;
	channel: BackendUserNotificationChannel;
	enabled: boolean;
	digestMode: BackendUserDigestMode;
	digestIntervalMinutes: number | null;
	digestTimes: string[];
	pausedUntil: string | null;
	channelConfigRef: string | null;
}

function parseDigestTimes(payload?: string | null): string[] {
	if (!payload) {
		return [];
	}
	try {
		const parsed = JSON.parse(payload) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

function defaultPreference(
	userId: number,
	channel: BackendUserNotificationChannel,
	channelConfigRef: string | null,
): BackendUserNotificationPreference {
	return {
		userId,
		channel,
		enabled: true,
		digestMode: "off",
		digestIntervalMinutes: null,
		digestTimes: [],
		pausedUntil: null,
		channelConfigRef,
	};
}

export class BackendUserNotificationPreferencesRepository {
	public constructor(private readonly db: AppDatabase) {}

	public async getPreference(input: {
		userId: number;
		channel: BackendUserNotificationChannel;
		channelConfigRef?: string | null;
	}): Promise<BackendUserNotificationPreference> {
		const channelConfigRef =
			input.channelConfigRef ??
			(input.channel === "email" ? "email:default" : input.channel);
		const [row] = await this.db
			.select()
			.from(adminUserNotificationPreferences)
			.where(
				and(
					eq(adminUserNotificationPreferences.userId, input.userId),
					eq(
						adminUserNotificationPreferences.channelConfigRef,
						channelConfigRef,
					),
				),
			)
			.limit(1);
		if (!row) {
			return defaultPreference(input.userId, input.channel, channelConfigRef);
		}

		return {
			userId: row.userId,
			channel: row.channel as BackendUserNotificationChannel,
			enabled: row.enabled,
			digestMode: row.digestMode as BackendUserDigestMode,
			digestIntervalMinutes: row.digestIntervalMinutes,
			digestTimes: parseDigestTimes(row.digestTimesJson),
			pausedUntil: row.pausedUntil,
			channelConfigRef: row.channelConfigRef,
		};
	}

	public async updatePreference(input: {
		userId: number;
		channel: BackendUserNotificationChannel;
		channelConfigRef?: string | null;
		enabled?: boolean;
		digestMode?: BackendUserDigestMode;
		digestIntervalMinutes?: number | null;
		digestTimes?: string[];
		pausedUntil?: string | null;
	}) {
		const current = await this.getPreference({
			userId: input.userId,
			channel: input.channel,
			channelConfigRef: input.channelConfigRef,
		});
		const channelConfigRef =
			input.channelConfigRef ??
			current.channelConfigRef ??
			(input.channel === "email" ? "email:default" : input.channel);
		const nowIso = new Date().toISOString();
		const next = {
			enabled: input.enabled ?? current.enabled,
			digestMode: input.digestMode ?? current.digestMode,
			digestIntervalMinutes:
				input.digestIntervalMinutes ?? current.digestIntervalMinutes,
			digestTimesJson: input.digestTimes
				? JSON.stringify(input.digestTimes)
				: JSON.stringify(current.digestTimes),
			pausedUntil:
				input.pausedUntil === undefined
					? current.pausedUntil
					: input.pausedUntil,
			channelConfigRef:
				input.channelConfigRef === undefined
					? channelConfigRef
					: input.channelConfigRef,
			updatedAt: nowIso,
		};

		await this.db
			.insert(adminUserNotificationPreferences)
			.values({
				userId: input.userId,
				channel: input.channel,
				...next,
				createdAt: nowIso,
			})
			.onConflictDoUpdate({
				target: [
					adminUserNotificationPreferences.userId,
					adminUserNotificationPreferences.channelConfigRef,
				],
				set: next,
			});

		return this.getPreference({
			userId: input.userId,
			channel: input.channel,
			channelConfigRef,
		});
	}

	public async isChannelAllowedForUser(input: {
		userId: number;
		channel: BackendUserNotificationChannel;
		channelConfigRef?: string | null;
		now?: Date;
	}) {
		const preference = await this.getPreference({
			userId: input.userId,
			channel: input.channel,
			channelConfigRef: input.channelConfigRef,
		});
		if (!preference.enabled) {
			return false;
		}
		if (
			preference.pausedUntil &&
			preference.pausedUntil > (input.now ?? new Date()).toISOString()
		) {
			return false;
		}
		return true;
	}
}
