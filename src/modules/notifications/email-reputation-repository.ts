import { and, eq, isNull, or } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { emailDeliveryReputation } from "../../db/schema";
import {
	hashNotificationEmail,
	isAcceptableNotificationEmail,
	normalizeNotificationEmail,
} from "./email-address-policy";

const suppressionThreshold = 5;
const suppressionMs = 7 * 24 * 60 * 60 * 1000;

export class EmailReputationRepository {
	public constructor(private readonly db: AppDatabase) {}

	private async get(siteId: number, emailHash: string) {
		const [row] = await this.db
			.select()
			.from(emailDeliveryReputation)
			.where(
				and(
					eq(emailDeliveryReputation.siteId, siteId),
					eq(emailDeliveryReputation.emailHash, emailHash),
				),
			)
			.limit(1);
		return row ?? null;
	}

	public async recordRecipientFailure(input: {
		siteId: number;
		email: string;
		reason: string;
		nowIso?: string;
	}) {
		if (!isAcceptableNotificationEmail(input.email)) {
			return null;
		}
		const email = normalizeNotificationEmail(input.email);
		const emailHash = hashNotificationEmail(email);
		if (!emailHash) {
			return null;
		}

		const existing = await this.get(input.siteId, emailHash);
		const timestamp = input.nowIso ?? new Date().toISOString();
		const failureScore = (existing?.failureScore ?? 0) + 1;
		const suppressedUntil =
			failureScore >= suppressionThreshold
				? new Date(new Date(timestamp).getTime() + suppressionMs).toISOString()
				: null;

		await this.db
			.insert(emailDeliveryReputation)
			.values({
				siteId: input.siteId,
				email,
				emailHash,
				failureScore,
				lastFailureAt: timestamp,
				suppressedUntil,
				suppressedReason: suppressedUntil ? input.reason : null,
				updatedAt: timestamp,
			})
			.onConflictDoUpdate({
				target: [
					emailDeliveryReputation.siteId,
					emailDeliveryReputation.emailHash,
				],
				set: {
					email,
					failureScore,
					lastFailureAt: timestamp,
					suppressedUntil,
					suppressedReason: suppressedUntil ? input.reason : null,
					updatedAt: timestamp,
				},
			});

		return this.get(input.siteId, emailHash);
	}

	public async recordSuccess(input: {
		siteId: number;
		email: string;
		nowIso?: string;
	}) {
		if (!isAcceptableNotificationEmail(input.email)) {
			return null;
		}
		const email = normalizeNotificationEmail(input.email);
		const emailHash = hashNotificationEmail(email);
		if (!emailHash) {
			return null;
		}
		const timestamp = input.nowIso ?? new Date().toISOString();

		await this.db
			.insert(emailDeliveryReputation)
			.values({
				siteId: input.siteId,
				email,
				emailHash,
				failureScore: 0,
				lastSuccessAt: timestamp,
				suppressedUntil: null,
				suppressedReason: null,
				updatedAt: timestamp,
			})
			.onConflictDoUpdate({
				target: [
					emailDeliveryReputation.siteId,
					emailDeliveryReputation.emailHash,
				],
				set: {
					email,
					failureScore: 0,
					lastSuccessAt: timestamp,
					suppressedUntil: null,
					suppressedReason: null,
					updatedAt: timestamp,
				},
			});

		return this.get(input.siteId, emailHash);
	}

	public async isSuppressed(input: {
		siteId: number;
		email: string;
		nowIso?: string;
	}) {
		const emailHash = hashNotificationEmail(input.email);
		if (!emailHash) {
			return false;
		}
		const timestamp = input.nowIso ?? new Date().toISOString();
		const [row] = await this.db
			.select()
			.from(emailDeliveryReputation)
			.where(
				and(
					eq(emailDeliveryReputation.siteId, input.siteId),
					eq(emailDeliveryReputation.emailHash, emailHash),
					or(
						isNull(emailDeliveryReputation.suppressedUntil),
						eq(emailDeliveryReputation.suppressedUntil, ""),
					),
				),
			)
			.limit(1);
		if (row) {
			return false;
		}
		const reputation = await this.get(input.siteId, emailHash);
		return Boolean(
			reputation?.suppressedUntil && reputation.suppressedUntil > timestamp,
		);
	}

	public async clearSuppression(input: {
		siteId: number;
		email: string;
		nowIso?: string;
	}) {
		const emailHash = hashNotificationEmail(input.email);
		if (!emailHash) {
			return null;
		}
		await this.db
			.update(emailDeliveryReputation)
			.set({
				suppressedUntil: null,
				suppressedReason: null,
				updatedAt: input.nowIso ?? new Date().toISOString(),
			})
			.where(
				and(
					eq(emailDeliveryReputation.siteId, input.siteId),
					eq(emailDeliveryReputation.emailHash, emailHash),
				),
			);
		return this.get(input.siteId, emailHash);
	}
}
