import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { commenterNotificationPreferences } from "../../db/schema";
import {
	hashNotificationEmail,
	isAcceptableNotificationEmail,
	normalizeNotificationEmail,
} from "./email-address-policy";

function createPreferenceId(): string {
	return `commenter_pref_${randomUUID().replaceAll("-", "")}`;
}

export class CommenterPreferencesRepository {
	public constructor(private readonly db: AppDatabase) {}

	public async upsertFromCommentForm(input: {
		siteId: number;
		email?: string | null;
		notifyOnReply: boolean;
	}) {
		if (!isAcceptableNotificationEmail(input.email)) {
			return null;
		}

		const email = normalizeNotificationEmail(input.email);
		const emailHash = hashNotificationEmail(email);
		if (!emailHash) {
			return null;
		}

		const timestamp = new Date().toISOString();
		const values = {
			id: createPreferenceId(),
			siteId: input.siteId,
			email,
			emailHash,
			notifyOnReply: input.notifyOnReply,
			unsubscribedAt: input.notifyOnReply ? null : undefined,
			source: "comment_form",
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		await this.db
			.insert(commenterNotificationPreferences)
			.values(values)
			.onConflictDoUpdate({
				target: [
					commenterNotificationPreferences.siteId,
					commenterNotificationPreferences.emailHash,
				],
				set: {
					email,
					notifyOnReply: input.notifyOnReply,
					unsubscribedAt: input.notifyOnReply ? null : undefined,
					source: "comment_form",
					updatedAt: timestamp,
				},
			});

		return this.getByEmailHash(input.siteId, emailHash);
	}

	public async getByEmailHash(siteId: number, emailHash: string) {
		const [row] = await this.db
			.select()
			.from(commenterNotificationPreferences)
			.where(
				and(
					eq(commenterNotificationPreferences.siteId, siteId),
					eq(commenterNotificationPreferences.emailHash, emailHash),
				),
			)
			.limit(1);
		return row ?? null;
	}

	public async unsubscribe(input: {
		siteId: number;
		emailHash: string;
		nowIso?: string;
	}) {
		const timestamp = input.nowIso ?? new Date().toISOString();
		await this.db
			.update(commenterNotificationPreferences)
			.set({
				notifyOnReply: false,
				unsubscribedAt: timestamp,
				source: "unsubscribe_link",
				updatedAt: timestamp,
			})
			.where(
				and(
					eq(commenterNotificationPreferences.siteId, input.siteId),
					eq(commenterNotificationPreferences.emailHash, input.emailHash),
				),
			);

		return this.getByEmailHash(input.siteId, input.emailHash);
	}
}
